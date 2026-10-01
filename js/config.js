/* =====================================================
 * config.js — 全局配置与数值表（平衡性调参都改这里）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};

  PE.CONFIG = {
    VERSION: '1.1.1',

    GRID: { COLS: 13, ROWS: 9, CELL: 1.2 },

    // 星核（基地）
    CORE: { col: 11, row: 4, maxHp: 20 },

    // 核心创意机制：星核光束
    BEAM: {
      baseDps: 18,        // 起始段每秒伤害
      chain: 4,           // 默认最大折射段数
      width: 1.05,        // 光束判定半径（世界单位）
      decay: 0.12,        // 每段伤害衰减 12%
      height: 0.85,       // 光束离地高度
      recomputeInterval: 0.25 // 链路重算周期（秒），兜底刷新
    },

    // 建造
    BUILD: {
      startEnergy: 120,
      sellRefund: 0.6,        // 回收返还比例
      energyTileDiscount: 0.4 // 能量格建造折扣 40%
    },

    // 波次奖励：35 + 波数 * 5
    WAVE_REWARD: { base: 35, per: 5 },
    MAX_WAVE: 15,
    BUILD_TIME: 20, // 波间自动开波倒计时（秒）；第 1 波不倒计时

    /* ---------- 塔（星墨手卷调色：青玉/黛蓝/月金） ---------- */
    TOWERS: {
      prism: {
        name: '棱镜', icon: '◈', color: 0x9fc4b4,
        cost: 60,
        desc: '折射星核光束，延长并强化伤害光路。它自己不攻击——它的武器是光。',
        tip: '光束会射向最近的棱镜，布设位置决定光路走向。',
        levels: [
          { gain: 1.15, upCost: 90 },
          { gain: 1.32, upCost: 144 },
          { gain: 1.58, upCost: null }
        ],
        stats: lv => `折射增益 ×${lv.gain}`
      },
      frost: {
        name: '霜塔', icon: '❄', color: 0x8aa3c0,
        cost: 50,
        desc: '寒冰力场：范围内敌人持续减速并受到微弱冻伤。',
        tip: '减速不叠加，取最强。适合铺在光路周围拖住敌人。',
        levels: [
          { radius: 2.6, slow: 0.30, dps: 3, upCost: 75 },
          { radius: 2.9, slow: 0.40, dps: 6, upCost: 120 },
          { radius: 3.3, slow: 0.50, dps: 11, upCost: null }
        ],
        stats: lv => `半径 ${lv.radius.toFixed(1)} · 减速 ${Math.round(lv.slow * 100)}% · ${lv.dps}/秒`
      },
      pulse: {
        name: '脉冲炮', icon: '✦', color: 0xc9a86a,
        cost: 70,
        desc: '经典动能武器：锁定单体发射高速弹丸。光束的可靠补刀。',
        tip: '优先攻击射程内走得最远的敌人。',
        levels: [
          { range: 4.6, cd: 0.8, dmg: 13, upCost: 105 },
          { range: 5.0, cd: 0.62, dmg: 23, upCost: 168 },
          { range: 5.5, cd: 0.46, dmg: 38, upCost: null }
        ],
        stats: lv => `射程 ${lv.range.toFixed(1)} · ${lv.dmg} 伤害 / ${lv.cd}s`
      }
    },

    /* ---------- 敌人（山海异兽 · 哑色） ---------- */
    ENEMIES: {
      drone:    { name: '蜂群',  hp: 30,  speed: 1.6,  bounty: 6,  coreDmg: 1, color: 0xc8452e, geo: 'octa',   size: 0.32 },
      runner:   { name: '游袭者', hp: 24,  speed: 3.0,  bounty: 5,  coreDmg: 1, color: 0xd9b06e, geo: 'tetra',  size: 0.28 },
      tank:     { name: '重装体', hp: 140, speed: 0.95, bounty: 14, coreDmg: 3, color: 0x6b7f9e, geo: 'box',    size: 0.44 },
      shield:   { name: '偏导体', hp: 72,  speed: 1.35, bounty: 12, coreDmg: 2, color: 0x7fae94, geo: 'ico',    size: 0.36, beamResist: 0.45 },
      splitter: { name: '裂生体', hp: 50,  speed: 1.7,  bounty: 8,  coreDmg: 1, color: 0x8fae7a, geo: 'dodeca', size: 0.34, splitsInto: ['runner', 2] },
      boss:     { name: '湮灭核心', hp: 380, speed: 0.8, bounty: 200, coreDmg: 8, color: 0xd0492f, geo: 'boss', size: 0.85 }
    },

    /* ---------- 波次编排（15 波） ---------- */
    WAVES: [
      [{ t: 'drone', n: 5 }],
      [{ t: 'drone', n: 8 }],
      [{ t: 'drone', n: 6 }, { t: 'runner', n: 3 }],
      [{ t: 'drone', n: 8 }, { t: 'runner', n: 5 }],
      [{ t: 'boss', n: 1 }, { t: 'drone', n: 6 }],
      [{ t: 'drone', n: 10 }, { t: 'runner', n: 6 }],
      [{ t: 'tank', n: 3 }, { t: 'drone', n: 8 }],
      [{ t: 'shield', n: 4 }, { t: 'runner', n: 8 }],
      [{ t: 'tank', n: 4 }, { t: 'shield', n: 3 }, { t: 'drone', n: 8 }],
      [{ t: 'boss', n: 1 }, { t: 'tank', n: 2 }, { t: 'runner', n: 4 }],
      [{ t: 'splitter', n: 6 }, { t: 'runner', n: 10 }],
      [{ t: 'tank', n: 5 }, { t: 'shield', n: 5 }],
      [{ t: 'splitter', n: 8 }, { t: 'tank', n: 4 }, { t: 'runner', n: 8 }],
      [{ t: 'shield', n: 8 }, { t: 'tank', n: 6 }, { t: 'drone', n: 10 }],
      [{ t: 'boss', n: 1 }, { t: 'splitter', n: 4 }, { t: 'shield', n: 4 }]
    ],

    // 敌人血量随波次成长系数
    waveHpMul: w => 1 + w * 0.07,

    // 无尽模式（15 波后）
    ENDLESS: {
      hpGrowth: 0.24,   // 每波额外 +24% HP
      budget: w => 14 + (w - 15) * 2.2
    }
  };
})();
