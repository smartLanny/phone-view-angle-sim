"""
最小的 USDC（二进制 USD，crate 格式）读取器，不依赖 USD 库。
只解析转换苹果 AR 模型用得到的部分：tokens / strings / fields / fieldsets / paths / specs，
以及常见的值类型（标量、向量、数组含压缩整数与浮点数组、token、资源路径、listOp、变体选择）。
composition（payload、变体）不在这里做，由调用方按需要的顺序在各层之间查值。
"""
import struct, numpy as np

def lz4_block(src, max_out):
    out = bytearray(); i = 0; n = len(src)
    while i < n:
        tok = src[i]; i += 1
        lit = tok >> 4
        if lit == 15:
            while True:
                b = src[i]; i += 1; lit += b
                if b != 255: break
        out += src[i:i+lit]; i += lit
        if i >= n: break
        off = src[i] | (src[i+1] << 8); i += 2
        ml = tok & 15
        if ml == 15:
            while True:
                b = src[i]; i += 1; ml += b
                if b != 255: break
        ml += 4
        start = len(out) - off
        if off >= ml: out += out[start:start+ml]
        else:
            for k in range(ml): out.append(out[start+k])
    return bytes(out)

def fast_decompress(buf, max_out):
    if buf[0] == 0: return lz4_block(buf[1:], max_out)
    n = buf[0]; p = 1; out = b''
    for _ in range(n):
        sz = struct.unpack_from('<i', buf, p)[0]; p += 4
        out += lz4_block(buf[p:p+sz], max_out); p += sz
    return out

def decode_ints(data, count, bits64=False):
    if bits64:
        common = struct.unpack_from('<q', data, 0)[0]; p = 8; fm = ['<h', '<i', '<q']
    else:
        common = struct.unpack_from('<i', data, 0)[0]; p = 4; fm = ['<b', '<h', '<i']
    ncb = (count * 2 + 7) // 8
    codes = data[p:p+ncb]; v = p + ncb
    out = np.empty(count, dtype=np.int64); prev = 0
    for i in range(count):
        c = (codes[i // 4] >> (2 * (i % 4))) & 3
        if c == 0: prev += common
        else:
            f = fm[c - 1]; d = struct.unpack_from(f, data, v)[0]; v += struct.calcsize(f); prev += d
        out[i] = prev
    return out

class Crate:
    def __init__(self, src):
        """src：文件路径，或文件内容（bytes，如从 USDZ 压缩包里直接读出的层）"""
        self.b = b = src if isinstance(src, (bytes, bytearray)) else open(src, 'rb').read()
        assert b[:8] == b'PXR-USDC'
        self.ver = tuple(b[8:11])
        toc = struct.unpack_from('<q', b, 16)[0]
        n = struct.unpack_from('<Q', b, toc)[0]; self.sec = {}
        for k in range(n):
            o = toc + 8 + k * 32
            name = b[o:o+16].split(b'\0')[0].decode(); start, size = struct.unpack_from('<qq', b, o + 16)
            self.sec[name] = start
        self._tokens(); self._strings(); self._fields(); self._fieldsets(); self._paths(); self._specs()

    def u64(self, o): return struct.unpack_from('<Q', self.b, o)[0]
    def cints(self, o, count, bits64=False):
        sz = self.u64(o); data = fast_decompress(self.b[o+8:o+8+sz], 0)
        return decode_ints(data, count, bits64), o + 8 + sz

    def _tokens(self):
        o = self.sec['TOKENS']; n = self.u64(o); un = self.u64(o+8); cs = self.u64(o+16)
        raw = fast_decompress(self.b[o+24:o+24+cs], un)
        self.tokens = [t.decode('utf-8', 'replace') for t in raw.split(b'\0')[:n]]
    def _strings(self):
        o = self.sec['STRINGS']; n = self.u64(o)
        self.strings = list(struct.unpack_from('<%dI' % n, self.b, o + 8))
    def _fields(self):
        o = self.sec['FIELDS']; n = self.u64(o)
        tok, o2 = self.cints(o + 8, n)
        sz = self.u64(o2); reps = fast_decompress(self.b[o2+8:o2+8+sz], n * 8)
        self.fields = [(self.tokens[int(t)], struct.unpack_from('<Q', reps, i*8)[0]) for i, t in enumerate(tok)]
    def _fieldsets(self):
        o = self.sec['FIELDSETS']; n = self.u64(o)
        self.fieldsets, _ = self.cints(o + 8, n)
    def _paths(self):
        o = self.sec['PATHS']; n = self.u64(o); ne = self.u64(o + 8)
        pi, o2 = self.cints(o + 16, ne); et, o3 = self.cints(o2, ne); jm, _ = self.cints(o3, ne)
        self.paths = [None] * n
        stack = [(0, None)]
        while stack:
            cur, parent = stack.pop()
            while True:
                t = cur; cur += 1
                if parent is None: parent = '/'; self.paths[pi[t]] = '/'; me = '/'
                else:
                    ti = int(et[t]); prop = ti < 0; tok = self.tokens[abs(ti)]
                    if prop: me = parent + '.' + tok
                    elif tok.startswith('{'): me = parent + tok
                    else: me = (parent if parent != '/' else '') + '/' + tok
                    self.paths[pi[t]] = me
                hasChild = jm[t] > 0 or jm[t] == -1; hasSib = jm[t] >= 0
                if hasChild:
                    if hasSib: stack.append((t + int(jm[t]), parent))
                    parent = me
                if not (hasChild or hasSib): break
    def _specs(self):
        o = self.sec['SPECS']; n = self.u64(o)
        pi, o2 = self.cints(o + 8, n); fs, o3 = self.cints(o2, n); st, _ = self.cints(o3, n)
        self.specs = {}
        for p, f, s in zip(pi, fs, st):
            flds = {}; k = int(f)
            while self.fieldsets[k] != 0xFFFFFFFF and self.fieldsets[k] != -1:
                name, rep = self.fields[int(self.fieldsets[k])]; flds[name] = rep; k += 1
            self.specs[self.paths[int(p)]] = (int(s), flds)

    # ---- 值 ----
    def value(self, rep):
        isArr = rep >> 63 & 1; inl = rep >> 62 & 1; comp = rep >> 61 & 1; ty = rep >> 48 & 0xFF; pay = rep & ((1 << 48) - 1)
        b = self.b
        S = {3:'i',4:'I',5:'q',6:'Q',8:'f',9:'d',20:'2f',23:'3d',24:'3f',19:'2d',28:'4f',27:'4d',17:'4f',16:'4d',15:'16d',22:'2i',26:'3i',30:'4i',7:'e',21:'2e',25:'3e',29:'4e',18:'4e'}
        if inl:
            if ty == 11: return self.tokens[pay]
            if ty == 10: return self.tokens[self.strings[pay]]
            if ty == 12: return self.tokens[pay]
            if ty in (1, 2, 42, 43, 44): return pay
            if ty == 3: return struct.unpack('<i', struct.pack('<I', pay & 0xFFFFFFFF))[0]
            if ty == 8: return struct.unpack('<f', struct.pack('<I', pay & 0xFFFFFFFF))[0]
            if ty == 9: return struct.unpack('<f', struct.pack('<I', pay & 0xFFFFFFFF))[0]
            if ty in (19, 20, 22, 23, 24, 26, 27, 28, 30):
                k = int(S[ty][0]); return [struct.unpack('<b', bytes([(pay >> (8*i)) & 0xFF]))[0] for i in range(k)]
            if ty == 15:
                d = [struct.unpack('<b', bytes([(pay >> (8*i)) & 0xFF]))[0] for i in range(4)]
                return np.diag(d).astype(float)
            return ('inline', ty, pay)
        o = pay
        if isArr:
            if o == 0: return []
            n = self.u64(o); o += 8
            if ty in (3, 4, 5, 6):
                if comp: return self.cints(o, n, ty in (5, 6))[0]
                return np.frombuffer(b, dtype={3:'<i4',4:'<u4',5:'<i8',6:'<u8'}[ty], count=n, offset=o)
            if ty in (8, 9, 7) and comp:
                code = chr(b[o]); o += 1
                if code == 'i': return self.cints(o, n)[0].astype(float)
                lut_n = struct.unpack_from('<I', b, o)[0]; o += 4
                dt = {8:'<f4', 9:'<f8', 7:'<f2'}[ty]; lut = np.frombuffer(b, dtype=dt, count=lut_n, offset=o); o += lut_n * lut.itemsize
                idx = self.cints(o, n)[0]; return lut[idx]
            if ty == 11: return [self.tokens[i] for i in struct.unpack_from('<%dI' % n, b, o)]
            if ty in S:
                f = S[ty]; k = int(f[:-1]) if len(f) > 1 else 1; dt = {'f':'<f4','d':'<f8','i':'<i4','e':'<f2','I':'<u4','q':'<i8'}[f[-1]]
                return np.frombuffer(b, dtype=dt, count=n * k, offset=o).reshape(n, k) if k > 1 else np.frombuffer(b, dtype=dt, count=n, offset=o)
            return ('array', ty, n)
        if ty == 11: return self.tokens[struct.unpack_from('<I', b, o)[0]]
        if ty in S:
            f = '<' + S[ty]; return struct.unpack_from(f, b, o) if len(S[ty]) > 1 else struct.unpack_from(f, b, o)[0]
        if ty == 41:  # TokenVector
            n = self.u64(o); return [self.tokens[i] for i in struct.unpack_from('<%dI' % n, b, o + 8)]
        if ty == 40:  # PathVector
            n = self.u64(o); return [self.paths[i] for i in struct.unpack_from('<%dI' % n, b, o + 8)]
        if ty == 34 or ty == 32:  # PathListOp / TokenListOp
            h = b[o]; o += 1; out = {}
            for bit, name in [(2,'explicit'),(4,'added'),(32,'prepended'),(64,'appended'),(8,'deleted'),(16,'ordered')]:
                if h & bit:
                    n = self.u64(o); idx = struct.unpack_from('<%dI' % n, b, o + 8); o += 8 + 4 * n
                    out[name] = [self.paths[i] if ty == 34 else self.tokens[i] for i in idx]
            return out
        if ty == 45:
            n = self.u64(o); o += 8; out = {}
            for _ in range(n):
                k, v = struct.unpack_from('<II', b, o); o += 8; out[self.tokens[self.strings[k]]] = self.tokens[self.strings[v]]
            return out
        return ('value', ty)

    def get(self, path, field):
        s = self.specs.get(path)
        if not s or field not in s[1]: return None
        return self.value(s[1][field])
