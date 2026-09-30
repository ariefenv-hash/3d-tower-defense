/* =====================================================
 * relics.js — 回响遗物池（Roguelike 核心②）
 *  每波结束三选一，一次性获取、本局永久生效。
 *  18 种遗物 + 互斥/稀有度规则 → 每局不同的构筑。
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};

  const RELICS = [
    /* ---- 光学流 ---- */
    { id: 'beam_dmg', tier: 'c', icon: '◈', name: '增透镀膜',
      desc: '星核光束伤害 +30%',
      apply: g => { g.mods.beamDmg *= 1.3; g.beams.markDirty(); } },
    { id: 'beam_chain', tier: 'c', icon: '∞', name: '全反射镜组',
      desc: '光束折射链 +2 段，能触达更远的棱镜',
      apply: g => { g.mods.beamChain += 2; g.beams.markDirty(); } },
    { id: 'beam_split', tier: 'e', icon: '⁑', name: '分光棱镜',
      desc: '星核额外发射一道独立寻路的光束',
      apply: g => { g.mods.beamSplits += 1; g.beams.markDirty(); } },
    { id: 'beam_width', tier: 'c', icon: '◉', name: '扩束透镜',
      desc: '光束判定宽度 +35%，更容易扫到敌人',
      can: m => !m.hasFocus,
      apply: g => { g.mods.beamWidth *= 1.35; g.mods.hasWidth = true; g.beams.markDirty(); } },
    { id: 'beam_focus', tier: 'r', icon: '◎', name: '高聚焦腔',
      desc: '光束宽度 −35%，伤害 +65%（窄而致命）',
      can: m => !m.hasFocus && !m.hasWidth,
      apply: g => { g.mods.beamWidth *= 0.65; g.mods.beamDmg *= 1.65; g.mods.hasFocus = true; g.beams.markDirty(); } },
    { id: 'no_decay', tier: 'e', icon: '⚡', name: '超导谐振腔',
      desc: '光束不再随折射段数衰减',
      apply: g => { g.mods.beamNoDecay = true; g.beams.markDirty(); } },
    { id: 'prism_gain', tier: 'r', icon: '◇', name: '谐振镀晶',
      desc: '每座棱镜的折射增益 +12%',
      apply: g => { g.mods.prismGainBonus += 0.12; g.beams.markDirty(); } },

    /* ---- 霜寒流 ---- */
    { id: 'frost_slow', tier: 'c', icon: '❄', name: '深寒核心',
      desc: '霜塔减速 +12%，力场冻伤翻倍',
      apply: g => { g.mods.frostSlowBonus += 0.12; g.mods.frostDpsMul *= 2; } },

    /* ---- 动能流 ---- */
    { id: 'pulse_rate', tier: 'c', icon: '✦', name: '过载电容',
      desc: '脉冲炮射速 +30%',
      apply: g => { g.mods.pulseRateMul *= 1.3; } },
    { id: 'pulse_dmg', tier: 'c', icon: '✧', name: '钨芯弹头',
      desc: '脉冲炮伤害 +40%',
      apply: g => { g.mods.pulseDmgMul *= 1.4; } },

    /* ---- 经济流 ---- */
    { id: 'bounty', tier: 'c', icon: '⌾', name: '能量虹吸',
      desc: '击杀掉落能量 +30%',
      apply: g => { g.mods.bountyMul *= 1.3; } },
    { id: 'interest', tier: 'r', icon: '%', name: '复利协议',
      desc: '每波结束获得存款 15% 的利息（至多 +40）',
      apply: g => { g.mods.interest += 0.15; } },
    { id: 'cheap_build', tier: 'r', icon: '⌂', name: '光子批量贸易',
      desc: '所有建造与升级费用 −12%',
      apply: g => { g.mods.buildCostMul *= 0.88; } },

    /* ---- 生存流 ---- */
    { id: 'core_hp', tier: 'r', icon: '✚', name: '纳米修复簇',
      desc: '星核上限 +5，并立即修复 5 点',
      apply: g => { g.coreMax += 5; g.coreHp = Math.min(g.coreMax, g.coreHp + 5); g.ui.refreshCore(); } },
    { id: 'second_life', tier: 'e', icon: '☾', name: '备用核心',
      desc: '星核承受致命打击时保留 1 点完整度（每局一次）',
      apply: g => { g.mods.secondLife = true; } },
    { id: 'global_slow', tier: 'r', icon: '⏳', name: '时空蜗行场',
      desc: '所有敌人移动速度 −10%',
      apply: g => { g.mods.enemySlowField = true; } },

    /* ---- 猎杀流 ---- */
    { id: 'hunt', tier: 'c', icon: '⌖', name: '猎杀协议',
      desc: '对完整度高于 60% 的敌人伤害 +25%',
      apply: g => { g.mods.huntMul *= 1.25; } },
    { id: 'execute', tier: 'r', icon: '☠', name: '处决协议',
      desc: '对完整度低于 30% 的敌人伤害 +35%',
      apply: g => { g.mods.execMul *= 1.35; } }
  ];

  const TIER_W = { c: 5, r: 3, e: 2 };
  const TIER_META = {
    c: { name: '常规', color: '#5ab8ff' },
    r: { name: '稀有', color: '#b57bff' },
    e: { name: '史诗', color: '#ffc94d' }
  };

  PE.relics = {
    RELICS,
    TIER_META,

    /** 随机抽出 n 个不重复且当前可用的遗物 */
    offer(game, n) {
      const owned = game.ownedRelics;
      const avail = RELICS.filter(r => !owned.has(r.id) && (!r.can || r.can(game.mods)));
      const out = [];
      const pool = avail.slice();
      while (out.length < n && pool.length) {
        // 按 tier 权重抽取
        let total = 0;
        for (const r of pool) total += TIER_W[r.tier];
        let roll = Math.random() * total;
        let pick = pool[0];
        for (const r of pool) { roll -= TIER_W[r.tier]; if (roll <= 0) { pick = r; break; } }
        out.push(pick);
        pool.splice(pool.indexOf(pick), 1);
      }
      return out;
    }
  };
})();
