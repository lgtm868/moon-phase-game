/* Normal-mode characters already packaged with Moon Games. */
(() => {
  'use strict';
  const entries = [
    ['oren', 'Oren', 'オレン', 'おれん', '#ff7900', '#fff0d9', 'kick'],
    ['raddy', 'Raddy', 'ラディ', 'らでぃ', '#f51414', '#fbe4e2', 'snare'],
    ['clukr', 'Clukr', 'クルーカー', 'くるーかー', '#b9bec4', '#e9eef1', 'rideTaiko'],
    ['funbot', 'Fun Bot', 'ファンボット', 'ふぁんぼっと', '#ffd33d', '#fbf4ce', 'amen'],
    ['vineria', 'Vineria', 'ヴィネリア', 'ゔぃねりあ', '#58d947', '#e6f0d9', 'shaker'],
    ['gray', 'Gray', 'グレー', 'ぐれー', '#6f737a', '#ecefea', 'bassPulse'],
    ['brud', 'brud', 'ブラッド', 'ぶらっど', '#8b5f33', '#f0e8dc', 'tomPulse'],
    ['garnold', 'Garnold', 'ガーノルド', 'がーのるど', '#d4aa28', '#fbf4ce', 'synthBell'],
    ['owakcx', 'OWAKCX', 'オワックス', 'おわっくす', '#78d946', '#e6f0d9', 'tinyArp'],
    ['sky', 'Sky', 'スカイ', 'すかい', '#71c9ff', '#e6f3fc', 'softClave'],
    ['mrsun', 'Mr. Sun', 'ミスターサン', 'みすたーさん', '#ffd94a', '#fbf4ce', 'sunPiano'],
    ['durple', 'Durple', 'ダープル', 'だーぷる', '#a649ff', '#f0e8fa', 'hornPulse'],
    ['mrtree', 'Mr. Tree', 'ミスターツリー', 'みすたーつりー', '#4aa352', '#e6f0d9', 'treeChord'],
    ['simon', 'Simon', 'サイモン', 'さいもん', '#ffe054', '#fbf4ce', 'brightLead'],
    ['tunner', 'Tunner', 'タナー', 'たなー', '#b89464', '#f0e8dc', 'whistle'],
    ['mrfun', 'Mr. Fun Computer', 'ミスターファンコンピューター', 'みすたーふぁん', '#8fd9ff', '#e6f3fc', 'brightLead'],
    ['wenda', 'Wenda', 'ウェンダ', 'うぇんだ', '#e9edf2', '#ecefea', 'whistle'],
    ['pinki', 'Pinki', 'ピンキー', 'ぴんきー', '#ff9ed5', '#fbe8f0', 'treeChord'],
    ['jevin', 'Jevin', 'ジェヴィン', 'じぇゔぃん', '#2867c8', '#e6f3fc', 'hornPulse'],
    ['black', 'Black', 'ブラック', 'ぶらっく', '#111111', '#ecefea', 'bassPulse']
  ];
  const characters = entries.map(([id, name, spokenName, hiragana, color, bg, music]) => Object.freeze({
    id, name, spokenName, hiragana, color, bg, music,
    displayName: id === 'mrfun' ? 'Mr. Fun' : name,
    file: 'sprunki-' + id + '.png',
    audio: 'sounds/' + id + (id === 'black' ? '.mp3' : '.wav')
  }));
  globalThis.SprunkiRoster = Object.freeze({ characters: Object.freeze(characters) });
})();
