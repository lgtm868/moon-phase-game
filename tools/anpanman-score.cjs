'use strict';

// Game-original instrumental parts. No television songs or recordings are used.
const RATE = 48000;
const BPM = 100;
const BEATS = 8;
const FRAMES = RATE * 60 / BPM * BEATS;
const TAU = Math.PI * 2;
const note = (beat, midi, length = .5, velocity = .8) => ({ beat, midi, length, velocity });
const scores = [
  { id: 'anpanman', title: 'Sunny steps', instrument: 'brass', notes: [note(0,72,.7),note(1,76,.45),note(1.75,79,.7),note(3,76,.6),note(4,74,.5),note(5,77,.6),note(6,79,1.2)] },
  { id: 'baikinman', title: 'Tiptoe bounce', instrument: 'plucked', notes: [note(.5,48,.25),note(1.25,55,.3),note(2.5,52,.3),note(3.5,50,.25),note(4.5,48,.3),note(5.25,57,.3),note(6.5,55,.4),note(7.25,50,.3)] },
  { id: 'dokinchan', title: 'Little sparkles', instrument: 'bell', notes: [note(.5,79,.4),note(1.5,84,.4),note(2.5,81,.5),note(3.25,79,.3),note(4.5,77,.4),note(5.5,81,.5),note(6.5,79,.4),note(7.25,76,.3)] },
  { id: 'shokupanman', title: 'Soft morning', instrument: 'piano', notes: [note(0,60,1),note(.5,64,.7),note(1,67,1),note(2,60,1),note(2.5,64,.7),note(3,69,.8),note(4,62,1),note(4.5,65,.7),note(5,69,1),note(6,59,.7),note(6.5,62,.7),note(7,67,.8)] },
  { id: 'currypanman', title: 'Round drum dance', instrument: 'drum', notes: [note(0,43,.25,1),note(.75,55,.18,.55),note(1.5,50,.22,.7),note(2,43,.25,.9),note(3,55,.18,.6),note(3.5,50,.18,.65),note(4,43,.25,1),note(5,50,.22,.7),note(5.75,55,.18,.6),note(6,43,.25,.85),note(7,50,.2,.7),note(7.5,55,.18,.55)] },
  { id: 'melonpanna', title: 'Floating petals', instrument: 'musicbox', notes: [note(.25,84,.65),note(1.25,81,.6),note(2.25,79,.55),note(3.25,76,.6),note(4.25,81,.7),note(5.25,77,.55),note(6.25,79,.8),note(7.25,74,.5)] },
  { id: 'rollpanna', title: 'Ribbon breeze', instrument: 'harp', notes: [note(0,60,.7),note(.75,67,.7),note(1.5,72,.7),note(2.25,76,.8),note(3.25,67,.6),note(4,62,.7),note(4.75,69,.7),note(5.5,74,.7),note(6.25,77,.8),note(7.25,67,.6)] },
  { id: 'creampanda', title: 'Hop and smile', instrument: 'marimba', notes: [note(0,72,.3),note(.5,74,.25,.65),note(1.5,76,.35),note(2.5,79,.3),note(3,76,.3,.7),note(4,74,.3),note(4.5,77,.25,.65),note(5.5,81,.35),note(6.5,79,.3),note(7,74,.3,.7)] },
  { id: 'jamojisan', title: 'Warm kitchen', instrument: 'bass', notes: [note(0,36,1.2),note(1.75,43,.65,.65),note(3,40,.55,.7),note(4,38,1.2),note(5.75,45,.65,.65),note(7,43,.55,.7)] },
  { id: 'batakosan', title: 'Busy little hands', instrument: 'wood', notes: Array.from({length:16},(_,i)=>note(i*.5,i%4===2?79:72,.13,i%4===0?.9:i%2===0?.65:.38)) }
];
const timbres = {
  brass: [[1,1],[2,.27],[3,.12],[4,.045]],
  plucked: [[1,1],[2,.35],[3,.17],[4,.06]],
  bell: [[1,1],[2,.25],[3,.09],[4.01,.05]],
  piano: [[1,1],[2,.43],[3,.15],[4,.065]],
  musicbox: [[1,1],[2,.21],[3,.07],[5,.025]],
  harp: [[1,1],[2,.32],[3,.14],[4,.05]],
  marimba: [[1,1],[3,.16],[7,.025]],
  bass: [[1,1],[2,.2],[3,.045]],
  wood: [[1,1],[2.76,.3],[4.1,.08]]
};

function renderTrack(score) {
  const data = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
  for (let index=0; index<score.notes.length; index++) {
    const event=score.notes[index];
    const f=440 * 2 ** ((event.midi-69)/12);
    const gate=event.length*60/BPM;
    const duration=score.instrument==='drum'?.24:score.instrument==='wood'?.13:gate+.42;
    const count=Math.round(duration*RATE), start=Math.round(event.beat*60/BPM*RATE);
    const pan=(index%3-1)*.18;
    const gains=[Math.sqrt((1-pan)/2),Math.sqrt((1+pan)/2)];
    for(let i=0;i<count;i++) {
      const t=i/RATE;
      const attack=score.instrument==='brass'?.023:.004;
      const onset=.5-.5*Math.cos(Math.PI*Math.min(1,t/attack));
      const release=.5-.5*Math.cos(Math.PI*Math.min(1,(duration-t)/.045));
      let sample=0;
      if(score.instrument==='drum') {
        const phase=TAU*f*(t+.006*(1-Math.exp(-t/.018)));
        sample=Math.sin(phase)*Math.exp(-t/.062)+.13*Math.sin(TAU*f*2.4*t)*Math.exp(-t/.025);
      } else {
        const decay=score.instrument==='bass'?2.8:score.instrument==='brass'?2.2:score.instrument==='wood'?37:5;
        for(const [partial,amplitude] of timbres[score.instrument]) {
          sample+=amplitude*Math.sin(TAU*f*partial*t)*Math.exp(-t*(decay+partial*.75));
        }
        if(t>gate) sample*=Math.exp(-(t-gate)*14);
      }
      const value=sample*onset*release*event.velocity;
      for(let c=0;c<2;c++) data[c][(start+i)%FRAMES]+=value*gains[c];
    }
  }
  // Circular early reflections include the preceding cycle's tail without a seam.
  const dry=data.map(channel=>channel.slice());
  for(let c=0;c<2;c++) for(let i=0;i<FRAMES;i++) {
    data[c][i]+=.07*dry[1-c][(i+FRAMES-3216)%FRAMES]+.045*dry[c][(i+FRAMES-5424)%FRAMES]+.025*dry[1-c][(i+FRAMES-8688)%FRAMES];
  }
  let peak=0,energy=0;
  for(const channel of data) {
    const mean=channel.reduce((sum,v)=>sum+v,0)/FRAMES;
    for(let i=0;i<FRAMES;i++) channel[i]-=mean;
    const delta=channel[0]-channel[FRAMES-1];
    for(let i=0;i<96;i++) channel[FRAMES-96+i]+=delta*(.5-.5*Math.cos(Math.PI*i/95));
    for(const sample of channel) {peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}
  }
  const rms=Math.sqrt(energy/(FRAMES*2));
  const scale=Math.min(.14/rms,.68/peak);
  for(const channel of data) for(let i=0;i<FRAMES;i++) channel[i]*=scale;
  return {id:score.id,title:score.title,instrument:score.instrument,rate:RATE,data,gain:.26};
}

function renderTracks() { return scores.map(renderTrack); }
module.exports={RATE,BPM,BEATS,FRAMES,scores,renderTracks};
