/* 程序化测试画面，按屏幕分辨率与方向生成。 */
(function (root) {
  'use strict';

  const CHECKER = [
    [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
    [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
    [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
    [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
  ];

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  const FONT = '-apple-system, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif';

  const avatar = new Image();
  const ready = new Promise((resolve) => {
    if (!root.AVATAR_SRC) { resolve(); return; }
    avatar.onload = avatar.onerror = () => resolve();
    avatar.src = root.AVATAR_SRC;
  });

  // [图标, 底色, 名称, { value | toggle }]
  const SETTINGS = [
    [
      ['plane', '#ff9500', '飞行模式', { toggle: false }],
      ['wifi', '#007aff', '无线局域网', { value: 'Home-5G' }],
      ['bt', '#007aff', '蓝牙', { value: '打开' }],
      ['cell', '#34c759', '蜂窝网络'],
      ['link', '#34c759', '个人热点', { value: '关闭' }],
    ],
    [
      ['bell', '#ff3b30', '通知'],
      ['sound', '#ff2d55', '声音与触感'],
      ['moon', '#5856d6', '专注模式'],
      ['hourglass', '#5856d6', '屏幕使用时间'],
    ],
    [
      ['gear', '#8e8e93', '通用'],
      ['toggles', '#8e8e93', '控制中心'],
      ['sun', '#007aff', '显示与亮度'],
      ['grid', '#5e5ce6', '主屏幕与 App 资源库'],
      ['person', '#007aff', '辅助功能'],
      ['flower', '#32ade6', '墙纸'],
      ['search', '#8e8e93', '搜索'],
      ['camera', '#8e8e93', '相机'],
    ],
    [
      ['hand', '#007aff', '隐私与安全性'],
      ['battery', '#34c759', '电池'],
    ],
  ];

  /** 在边长 s、中心 (cx, cy) 的方块内绘制图标，内部坐标系为 ±50。bg 用于镂空。 */
  function glyph(g, name, cx, cy, s, bg, fg = '#fff') {
    const D = Math.PI / 180;
    g.save();
    g.translate(cx, cy); g.scale(s / 100, s / 100);
    g.fillStyle = g.strokeStyle = fg;
    g.lineWidth = 6; g.lineCap = g.lineJoin = 'round';
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    const ring = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); };
    const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0 * D, a1 * D); g.stroke(); };
    const path = (p, close) => {
      g.beginPath(); g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      if (close) { g.closePath(); g.fill(); } else g.stroke();
    };
    const hole = (fn) => { g.fillStyle = bg; fn(); g.fillStyle = fg; };
    const pill = (x, y, w, h, r) => { roundRect(g, x, y, w, h, r); g.fill(); };

    switch (name) {
      case 'plane':
        g.rotate(90 * D);
        path([0, -34, 5, -26, 5, -8, 32, 8, 32, 15, 5, 6, 5, 22, 13, 28, 13, 33, 0, 29, -13, 33, -13, 28, -5, 22,
          -5, 6, -32, 15, -32, 8, -5, -8, -5, -26], true);
        break;
      case 'wifi':
        g.lineWidth = 7;
        [13, 26, 39].forEach((r) => arc(0, 20, r, -135, -45));
        dot(0, 20, 5);
        break;
      case 'bt':
        path([-14, -14, 14, 14, 0, 28, 0, -28, 14, -14, -14, 14]);
        break;
      case 'cell':
        dot(0, -8, 5);
        path([0, -8, 0, 28]);
        [14, 25].forEach((r) => { arc(0, -8, r, -40, 40); arc(0, -8, r, 140, 220); });
        break;
      case 'link':
        g.lineWidth = 7;
        g.rotate(-45 * D);
        roundRect(g, -30, -9, 34, 18, 9); g.stroke();
        roundRect(g, -4, -9, 34, 18, 9); g.stroke();
        break;
      case 'bell':
        roundRect(g, -26, -20, 46, 46, 11); g.stroke();
        hole(() => dot(21, -21, 15));
        dot(21, -21, 9);
        break;
      case 'sound':
        path([-28, -10, -14, -10, 4, -26, 4, 26, -14, 10, -28, 10], true);
        arc(4, 0, 14, -45, 45); arc(4, 0, 26, -45, 45);
        break;
      case 'moon':
        dot(-3, 2, 27);
        hole(() => dot(12, -10, 22));
        break;
      case 'hourglass':
        path([-18, -26, 18, -26, 0, 0], true);
        path([0, 0, 18, 26, -18, 26], true);
        pill(-24, -33, 48, 7, 3); pill(-24, 26, 48, 7, 3);
        break;
      case 'gear':
        for (let k = 0; k < 8; k++) {
          g.save(); g.rotate(k * 45 * D); pill(-6, -35, 12, 16, 3); g.restore();
        }
        dot(0, 0, 25);
        hole(() => dot(0, 0, 11));
        break;
      case 'toggles':
        g.lineWidth = 5;
        roundRect(g, -30, -24, 60, 18, 9); g.stroke(); dot(-21, -15, 7);
        roundRect(g, -30, 6, 60, 18, 9); g.stroke(); dot(21, 15, 7);
        break;
      case 'sun':
        dot(0, 0, 12);
        for (let k = 0; k < 8; k++) {
          const a = k * 45 * D;
          path([Math.cos(a) * 21, Math.sin(a) * 21, Math.cos(a) * 31, Math.sin(a) * 31]);
        }
        break;
      case 'grid':
        [[-28, -28], [4, -28], [-28, 4], [4, 4]].forEach(([x, y]) => pill(x, y, 24, 24, 6));
        break;
      case 'person':
        dot(0, -24, 7);
        path([-24, -11, 24, -11]);
        path([0, -11, 0, 6, -12, 29]);
        path([0, 6, 12, 29]);
        break;
      case 'flower':
        for (let k = 0; k < 6; k++) dot(Math.cos(k * 60 * D) * 15, Math.sin(k * 60 * D) * 15, 11);
        hole(() => dot(0, 0, 7));
        break;
      case 'search':
        g.lineWidth = 7;
        ring(-6, -6, 17);
        g.lineWidth = 8;
        path([7, 7, 26, 26]);
        break;
      case 'camera':
        pill(-32, -18, 64, 44, 9);
        pill(-13, -27, 26, 14, 5);
        hole(() => dot(0, 4, 15));
        dot(0, 4, 9);
        break;
      case 'hand':
        pill(-20, -4, 38, 34, 14);
        [[-20, -24], [-10, -32], [0, -30], [10, -22]].forEach(([x, y]) => pill(x, y, 8, 34, 4));
        g.save(); g.translate(16, 6); g.rotate(35 * D); pill(-4, -20, 8, 26, 4); g.restore();
        break;
      case 'battery':
        g.lineWidth = 5;
        roundRect(g, -30, -14, 54, 28, 7); g.stroke();
        pill(27, -6, 5, 12, 2);
        pill(-24, -8, 32, 16, 3);
        break;
    }
    g.restore();
  }

  function chevron(g, x, cy, u, col) {
    g.save();
    g.strokeStyle = col; g.lineWidth = 0.55 * u; g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x - 1.7 * u, cy - 1.8 * u); g.lineTo(x, cy); g.lineTo(x - 1.7 * u, cy + 1.8 * u);
    g.stroke();
    g.restore();
  }

  function toggle(g, right, cy, u, on, offColor) {
    const w = 13 * u, h = 7.9 * u, x = right - w;
    g.fillStyle = on ? '#34c759' : offColor;
    roundRect(g, x, cy - h / 2, w, h, h / 2); g.fill();
    g.save();
    g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 1.2 * u; g.shadowOffsetY = 0.4 * u;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(on ? x + w - h / 2 : x + h / 2, cy, h / 2 - 0.5 * u, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function statusBar(g, W, u, col) {
    const cy = 6.4 * u;
    g.fillStyle = col;
    g.font = `600 ${4.3 * u}px ${FONT}`;
    g.textAlign = 'center'; g.fillText('9:41', 17 * u, cy); g.textAlign = 'left';
    [1.1, 1.6, 2.2, 2.8].forEach((h, i) => { roundRect(g, W - 27 * u + i * 1.15 * u, cy + 1.4 * u - h * u, 0.8 * u, h * u, 0.25 * u); g.fill(); });
    glyph(g, 'wifi', W - 18.6 * u, cy - 0.2 * u, 6 * u, null, col);
    const bw = 6.4 * u, bh = 3.1 * u, bx = W - 14 * u, by = cy - bh / 2;
    g.save();
    g.globalAlpha = 0.4; g.strokeStyle = col; g.lineWidth = 0.28 * u;
    roundRect(g, bx, by, bw, bh, 0.9 * u); g.stroke();
    g.fillRect(bx + bw + 0.35 * u, by + 0.95 * u, 0.4 * u, bh - 1.9 * u);
    g.restore();
    roundRect(g, bx + 0.55 * u, by + 0.55 * u, (bw - 1.1 * u) * 0.8, bh - 1.1 * u, 0.5 * u); g.fill();
  }

  /** 类 iOS 设置页（浅色 / 深色），不含任何品牌标识。 */
  function ui(g, W, H, dark) {
    const u = Math.min(W, H) / 100, land = W > H;
    const c = dark
      ? { bg: '#000', card: '#1c1c1e', text: '#fff', sub: '#8d8d93', line: '#38383a', chev: '#5b5b60', field: '#1c1c1e', off: '#39393d' }
      : { bg: '#f2f2f7', card: '#fff', text: '#000', sub: '#8a8a8e', line: '#c6c6c8', chev: '#c4c4c7', field: '#e3e3e9', off: '#e9e9eb' };
    const font = (w, px) => `${w} ${px * u}px ${FONT}`;
    const m = land ? 14 * u : 4 * u, cw = W - 2 * m, r = 3 * u;
    const sep = Math.max(1, 0.1 * u);
    g.textBaseline = 'middle';
    g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
    if (!land) statusBar(g, W, u, c.text);

    let y = land ? 12 * u : 20.5 * u;
    g.fillStyle = c.text; g.font = font(700, 8.6);
    g.fillText('设置', m, y);
    y += 6 * u;

    g.fillStyle = c.field; roundRect(g, m, y, cw, 9 * u, 2.6 * u); g.fill();
    glyph(g, 'search', m + 5 * u, y + 4.5 * u, 5 * u, c.field, c.sub);
    g.fillStyle = c.sub; g.font = font(400, 4.3);
    g.fillText('搜索', m + 8.6 * u, y + 4.6 * u);
    y += 14 * u;

    const ph = 19 * u, ar = 7.5 * u, ax = m + 4 * u + ar, ay = y + ph / 2;
    g.fillStyle = c.card; roundRect(g, m, y, cw, ph, r); g.fill();
    g.save();
    g.beginPath(); g.arc(ax, ay, ar, 0, Math.PI * 2); g.clip();
    if (avatar.naturalWidth) g.drawImage(avatar, ax - ar, ay - ar, 2 * ar, 2 * ar);
    else { g.fillStyle = '#9aa0ac'; g.fill(); }
    g.restore();
    const tx = ax + ar + 4 * u;
    g.fillStyle = c.text; g.font = font(500, 5.2); g.fillText('野生的装机宅', tx, ay - 2.6 * u);
    g.fillStyle = c.sub; g.font = font(400, 3.4);
    g.fillText('@bilibili', tx, ay + 3 * u, m + cw - tx - 9 * u);
    chevron(g, m + cw - 4 * u, ay, u, c.chev);
    y += ph + 8.5 * u;

    const rh = 11.6 * u, isz = 7.4 * u, ix = m + 4 * u, lx = ix + isz + 4 * u, rx = m + cw - 4 * u;
    for (const group of SETTINGS) {
      if (y > H) break;
      g.fillStyle = c.card; roundRect(g, m, y, cw, rh * group.length, r); g.fill();
      group.forEach(([icon, color, label, opt = {}], i) => {
        const cy = y + rh * (i + 0.5);
        g.fillStyle = color; roundRect(g, ix, cy - isz / 2, isz, isz, 1.7 * u); g.fill();
        glyph(g, icon, ix + isz / 2, cy, isz, color);
        g.fillStyle = c.text; g.font = font(400, 4.3);
        g.fillText(label, lx, cy);
        if ('toggle' in opt) toggle(g, rx, cy, u, opt.toggle, c.off);
        else {
          chevron(g, rx, cy, u, c.chev);
          if (opt.value) {
            g.fillStyle = c.sub; g.textAlign = 'right';
            g.fillText(opt.value, rx - 4 * u, cy); g.textAlign = 'left';
          }
        }
        if (i < group.length - 1) { g.fillStyle = c.line; g.fillRect(lx, y + rh * (i + 1) - sep / 2, m + cw - lx, sep); }
      });
      y += rh * group.length + 8.5 * u;
    }

    g.fillStyle = c.text;
    roundRect(g, W / 2 - 17 * u, H - 3.2 * u, 34 * u, 1.3 * u, 0.65 * u); g.fill();
  }

  /** 阅读页：大小字号、浅灰卡片、蓝色链接混排，用来看大角度下文字还认不认得出。 */
  const READ = [
    ['h', '周末出行计划'],
    ['s', '10 月 4 日 周六 · 共 3 项'],
    ['t', '08:30  出发'],
    ['p', '地铁 2 号线换乘 10 号线，出站后步行约 600 米。记得带上身份证和充电宝。'],
    ['t', '10:00  美术馆'],
    ['p', '提前在小程序预约 10:00 场次，入口在东门。三楼的临展只开放到下午四点。'],
    ['c', '提醒', '馆内禁止使用闪光灯，大件行李需寄存。'],
    ['t', '12:30  午饭'],
    ['p', '附近那家面馆中午排队较长，可以先在线取号。备选：商场五楼的简餐。'],
    ['t', '15:00  河边散步'],
    ['p', '天气预报 22°C 多云，傍晚有风，带一件薄外套。'],
    ['l', '查看路线详情'],
  ];
  function read(g, W, H, dark) {
    const u = Math.min(W, H) / 100, land = W > H;
    const c = dark
      ? { bg: '#000', text: '#f2f2f2', sub: '#8d8d93', card: '#1c1c1e', link: '#4c9dff', rule: '#2c2c2e' }
      : { bg: '#fff', text: '#111', sub: '#8a8a8e', card: '#f2f3f5', link: '#1a73e8', rule: '#e5e5ea' };
    const m = land ? 14 * u : 5.5 * u, cw = W - 2 * m;
    const font = (w, px) => `${w} ${px * u}px ${FONT}`;
    g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
    if (!land) statusBar(g, W, u, c.text);
    g.textBaseline = 'alphabetic';

    // 按字符折行（中文无空格）
    const wrap = (text, x, y, maxW, lh) => {
      let line = '';
      for (const ch of text) {
        if (g.measureText(line + ch).width > maxW && line) { g.fillText(line, x, y); y += lh; line = ch; } else line += ch;
      }
      if (line) { g.fillText(line, x, y); y += lh; }
      return y;
    };

    let y = land ? 14 * u : 24 * u;
    for (const [kind, a, b] of READ) {
      if (y > H - 6 * u) break;
      g.fillStyle = c.text;
      switch (kind) {
        case 'h': g.font = font(700, 7.4); g.fillText(a, m, y); y += 6.5 * u; break;
        case 's': g.fillStyle = c.sub; g.font = font(400, 3.6); g.fillText(a, m, y); y += 9 * u;
          g.fillStyle = c.rule; g.fillRect(m, y - 5.5 * u, cw, Math.max(1, 0.12 * u)); break;
        case 't': g.font = font(600, 4.9); g.fillText(a, m, y); y += 6.4 * u; break;
        case 'p': g.font = font(400, 4.2); y = wrap(a, m, y, cw, 6.3 * u) + 3.4 * u; break;
        case 'c': {
          g.font = font(400, 3.9);
          const lines = Math.ceil(g.measureText(b).width / (cw - 8 * u)) || 1;
          const ch = (8.5 + lines * 5.6) * u;
          g.fillStyle = c.card; roundRect(g, m, y - 4.5 * u, cw, ch, 3 * u); g.fill();
          g.fillStyle = c.text; g.font = font(600, 3.9); g.fillText(a, m + 4 * u, y + 1 * u);
          g.fillStyle = c.sub; g.font = font(400, 3.9);
          wrap(b, m + 4 * u, y + 6.8 * u, cw - 8 * u, 5.6 * u);
          y += ch + 5 * u;
          break;
        }
        case 'l': g.fillStyle = c.link; g.font = font(500, 4.2); g.fillText(a + ' ›', m, y); y += 7 * u; break;
      }
    }
    g.fillStyle = c.text;
    roundRect(g, W / 2 - 17 * u, H - 3.2 * u, 34 * u, 1.3 * u, 0.65 * u); g.fill();
  }

  function gray(g, W, H) {
    const bands = 12;
    for (let i = 0; i < bands; i++) {
      const v = Math.round(255 * (1 - i / (bands - 1)));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, (i * H) / bands, W / 2, H / bands + 1);
    }
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#000');
    g.fillStyle = grad; g.fillRect(W / 2, 0, W / 2, H);
  }

  function checker(g, W, H) {
    const portrait = H >= W;
    const cols = portrait ? 4 : 6, rows = portrait ? 6 : 4;
    g.fillStyle = '#202020'; g.fillRect(0, 0, W, H);
    const gap = Math.min(W, H) * 0.02;
    const cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * (rows + 1)) / rows;
    for (let i = 0; i < 24; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const [R, G, B] = CHECKER[i];
      g.fillStyle = `rgb(${R},${G},${B})`;
      g.fillRect(gap + c * (cw + gap), gap + r * (ch + gap), cw, ch);
    }
  }

  function rgbw(g, W, H) {
    const cols = ['#ffffff', '#ff0000', '#00ff00', '#0000ff'];
    const portrait = H >= W;
    cols.forEach((c, i) => {
      g.fillStyle = c;
      if (portrait) g.fillRect(0, (i * H) / 4, W, H / 4 + 1);
      else g.fillRect((i * W) / 4, 0, W / 4 + 1, H);
    });
  }

  function make(name, W, H) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.textBaseline = 'alphabetic';
    switch (name) {
      case 'white': g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); break;
      case 'gray': gray(g, W, H); break;
      case 'checker': checker(g, W, H); break;
      case 'rgbw': rgbw(g, W, H); break;
      case 'dark': ui(g, W, H, true); break;
      case 'read': read(g, W, H, false); break;
      default: ui(g, W, H, false);
    }
    return cv;
  }

  root.Patterns = { make, ready };
})(window);
