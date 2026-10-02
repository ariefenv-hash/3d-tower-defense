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
    c: { name: '凡品', color: '#8fa0b6' },
    r: { name: '珍品', color: '#c9a86a' },
    e: { name: '孤品', color: '#d0492f' },
    f: { name: '残页', color: '#b3a581' }
  };

  /* ---- 星屑残页（无限池）----
   * 无尽模式后期 18 遗物拾尽后，三选一以残页补齐。
   * 残页可无限重拾、同类叠加，保证无尽模式永远有得选、构筑持续成长。
   * 数值口径：无尽敌人 HP 线性成长 +24%/波，残页每波一页的小额叠加与之匹配。 */
  const FRAGMENTS = [
    { id: 'frag_dmg', tier: 'f', frag: true, icon: '✧', name: '星屑残页 · 锋',
      desc: '星核光束伤害 +8%（残页可无限重拾）',
      apply: g => { g.mods.beamDmg *= 1.08; g.beams.markDirty(); } },
    { id: 'frag_gain', tier: 'f', frag: true, icon: '◇', name: '星屑残页 · 谐',
      desc: '每座棱镜的折射增益 +4%（残页可无限重拾）',
      apply: g => { g.mods.prismGainBonus += 0.04; g.beams.markDirty(); } },
    { id: 'frag_bounty', tier: 'f', frag: true, icon: '⌾', name: '星屑残页 · 富',
      desc: '击杀掉落能量 +8%（残页可无限重拾）',
      apply: g => { g.mods.bountyMul *= 1.08; } },
    { id: 'frag_core', tier: 'f', frag: true, icon: '✚', name: '星屑残页 · 愈',
      desc: '星核上限 +2，并立即修复 2 点（残页可无限重拾）',
      apply: g => { g.coreMax += 2; g.coreHp = Math.min(g.coreMax, g.coreHp + 2); g.ui.refreshCore(); } }
  ];

  PE.relics = {
    RELICS,
    FRAGMENTS,
    TIER_META,

    /** 随机抽出 n 个不重复且当前可用的遗物；
     *  池子不足（无尽后期 18 遗物拾尽）时，以可无限重拾的星屑残页补齐，
     *  保证返回值永远 ≥ min(n, 残页数) 张，杜绝空三选一导致的流程锁死。 */
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
      // 星屑残页补齐：先去重抽（4 种 ≥ 3 张需求），不够再随机重复（兑底）
      const frags = FRAGMENTS.slice();
      while (out.length < n && frags.length) {
        out.push(frags.splice(Math.floor(Math.random() * frags.length), 1)[0]);
      }
      while (out.length < n) {
        out.push(FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)]);
      }
      return out;
    }
  };
})();
