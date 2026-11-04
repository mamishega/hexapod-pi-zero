// Simulated Servo 2040 for testing playback without a robot. It mirrors
// Board Files/motion_bridge.py: the same commands, checks, 20 ms interpolation
// steps and replies. Nothing here touches USB or a servo.
import {NAMES,LIMITS,JOINT_LIMITS,JOINT_NAMES,DEFAULT_OFFSETS,MIN_DURATION,MAX_DURATION,WALK_RAMP,WALK_GAITS,GAIT_BLEND_CYCLES,gaitRoute,mixGait,anglesForPose,clone,home,interpolationSteps,validateWalk,walkPose,walkAmplitude} from './model.js';
import {PROTOCOL} from './transport.js';

const HARD_JOINT_LIMITS=[[-180,180],[-180,180],[-180,180]];
const ease=(fraction,mode)=>mode==='smooth'?0.5-0.5*Math.cos(Math.PI*fraction):fraction;
const blend=(start,end,fraction)=>start.map((xyz,i)=>xyz.map((v,j)=>v+(end[i][j]-v)*fraction));
const number=value=>typeof value==='number'&&Number.isFinite(value);
// Gentle Enable, as motion_bridge.py: legs with an unknown position switch on this far apart.
export const ARM_STAGGER_MS=150;
// Live walk steering, as motion_bridge.py STEER_MIN_RATE: direction units per second at least.
export const STEER_MIN_RATE=2.0;

export class SimulatedLink {
  constructor(event,lost,{now=()=>Date.now()}={}) {
    this.event=event;this.lost=lost;this.now=now;this.simulated=true;
    this.active=false;this.current=null;this.angles=null;this.transition=null;this.queued=null;this.walk=null;this.arming=null;this.midStep=false;this.released=new Set();
    // Board-side limits; shared with the app through setBoardLimits on connect.
    this.jointLimits=clone(JOINT_LIMITS);
    this.offsets=clone(DEFAULT_OFFSETS);this.calLeg=null;this.calHolding=false;this.savedOffsets=null;
  }
  async open(){return this.send('hello');}
  async close(){this.closed=true;}
  send(op,args={},guard=()=>true) {
    return Promise.resolve().then(()=>{
      if(!guard())throw new Error('Movement cancelled.');
      if(this.closed)throw new Error('Robot is disconnected.');
      this.update();
      return clone(this.handle({...args,op}));
    });
  }
  poseAngles(pose,offsets=this.offsets) {
    // Same checks as the board: workspace, reach and joint limits (no collisions).
    const saved=clone(JOINT_LIMITS);
    this.jointLimits.forEach((p,j)=>{JOINT_LIMITS[j][0]=p[0];JOINT_LIMITS[j][1]=p[1];});
    try{return anglesForPose(pose,offsets);}
    finally{saved.forEach((p,j)=>{JOINT_LIMITS[j][0]=p[0];JOINT_LIMITS[j][1]=p[1];});}
  }
  update() {
    if(this.arming){this.armUpdate();return;}
    if(this.walk){this.walkUpdate();return;}
    const transition=this.transition;if(!transition)return;
    const elapsed=Math.max(0,this.now()-transition.started);
    const step=Math.min(transition.steps,Math.floor(elapsed*transition.steps/transition.duration));
    if(step<=transition.last)return;
    this.current=blend(transition.start,transition.target,ease(step/transition.steps,transition.ease));
    this.angles=this.poseAngles(this.current);transition.last=step;
    if(step===transition.steps){
      // Start the queued pose on schedule, as the board does.
      const queued=this.queued;this.queued=null;this.transition=queued;
      if(queued){queued.started=transition.started+transition.duration;this.update();}
    }
  }
  stopMotion(){
    if(this.walk)this.midStep=true;
    // Legs not yet switched on by a staggered Enable stay off: their position is unknown.
    if(this.arming){this.released=new Set([0,1,2,3,4,5].filter(i=>i>=this.arming.leg));this.arming=null;}
    this.transition=null;this.queued=null;this.walk=null;
  }
  // Staggered Enable (unknown start): one leg every ARM_STAGGER_MS, then hold home.
  armUpdate(){
    const arming=this.arming,legs=Math.min(6,1+Math.floor((this.now()-arming.started)/ARM_STAGGER_MS));
    arming.leg=Math.max(arming.leg,legs);
    if(arming.leg>=6){this.arming=null;this.current=home(70);this.angles=this.poseAngles(this.current);}
  }
  armGently(glide){
    if(!Number.isInteger(glide)||glide<MIN_DURATION||glide>MAX_DURATION)throw new Error(`Glide must be ${MIN_DURATION}..${MAX_DURATION} milliseconds`);
    const target=home(70);this.poseAngles(target);
    const known=this.current&&this.released.size===0&&!this.calHolding;
    if(known){
      const start=clone(this.current),steps=interpolationSteps(glide);
      for(let step=1;step<=steps;step++)this.poseAngles(blend(start,target,ease(step/steps,'smooth')));
      this.angles=this.poseAngles(start);
      this.transition={start,target,duration:glide,steps,ease:'smooth',started:this.now(),last:0};
    } else {this.current=null;this.angles=null;this.arming={leg:1,started:this.now()};}
  }
  // Live walking, as the board's walk_tick(): steer gradually, ramp speed, end in the base stance.
  walkUpdate(){
    // As the board's walk_tick(): the cycle position accumulates at the current
    // speed, and direction and settings are reached gradually.
    // Unlike the board, this updates only when a command arrives (~200 ms apart), so the
    // board's per-update time cap (MAX_WALK_STEP_MS) is not applied here.
    const walk=this.walk,now=this.now(),elapsed=Math.max(0,now-walk.lastTime),advance=elapsed/walk.period,approach=(v,g,l)=>v+Math.max(-l,Math.min(l,g-v));
    walk.lastTime=now;walk.cycle+=advance;const cycle=walk.cycle;
    // One direction unit per cycle, but at least STEER_MIN_RATE per second.
    const steer=Math.max(advance,elapsed/1000*STEER_MIN_RATE);
    walk.direction=walk.direction.map((d,k)=>approach(d,walk.target[k],steer));
    for(const [key,rate] of [['stride',40],['lift',30],['hipSwing',20]])walk[key]=approach(walk[key],walk.goal[key],advance*rate);
    const done=walk.stopAt!==null&&cycle>=walk.stopAt+WALK_RAMP;
    this.current=done?clone(walk.endBase||walk.base):walkPose(this.stopBase(walk,cycle),{...walk,gait:this.walkGait(walk),direction:walk.direction},this.walkAmp(walk,cycle),cycle%1);this.angles=this.poseAngles(this.current);
    if(done)this.walk=null;
  }
  // Step size now, as the board's walk_amp(): ramps up at the start or after resuming, down when stopping.
  walkAmp(walk,cycle){
    if(!walk.ramp)return walkAmplitude(cycle,walk.stopAt);
    const s=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
    let amplitude=walk.ramp.from+(1-walk.ramp.from)*s((cycle-walk.ramp.start)/WALK_RAMP);
    if(walk.stopAt!==null)amplitude=Math.min(amplitude,s(1-(cycle-walk.stopAt)/WALK_RAMP));
    return amplitude;
  }
  // Gait timing now: a name, or [stance, phases] part way through a gait blend.
  walkGait(walk){
    const blend=walk.blend;if(!blend)return walk.gait;
    let fraction=(walk.cycle-blend.start)/GAIT_BLEND_CYCLES;
    while(fraction>=1){const done=blend.queue.shift();if(!blend.queue.length){walk.blend=null;return done;}blend.from=WALK_GAITS[done];blend.start+=GAIT_BLEND_CYCLES;fraction-=1;}
    return mixGait(blend.from,WALK_GAITS[blend.queue[0]],fraction);
  }
  blendGait(walk,gait){
    if(!walk.blend)walk.blend={from:WALK_GAITS[walk.gait],queue:gaitRoute(walk.gait,gait),start:walk.cycle};
    else{const stage=walk.blend.queue[0];walk.blend.queue=[stage,...gaitRoute(stage,gait).filter(g=>g!==stage)];}
    walk.gait=gait;
  }
  // While stopping into a pose, the stance glides to it as the steps die down.
  stopBase(walk,cycle){
    if(!walk.endBase||walk.stopAt===null)return walk.base;
    const x=Math.max(0,Math.min(1,(cycle-walk.stopAt)/WALK_RAMP)),e=x*x*(3-2*x);return blend(walk.base,walk.endBase,e);
  }
  checkStopTo(walk,target){
    const gait=this.walkGait(walk);
    for(let f=0;f<=10;f++){const x=f/10,e=x*x*(3-2*x),amplitude=1-e,base=blend(walk.base,target,e);
      for(let n=0;n<24;n++)this.poseAngles(walkPose(base,{gait,direction:walk.target,stride:walk.goal.stride,lift:walk.goal.lift,hipSwing:walk.goal.hipSwing},amplitude,n/24));}
  }
  walkStopping(){return this.walk.stopAt!==null&&this.walk.cycle>=this.walk.stopAt;}
  checkWalk(base,params){for(const amplitude of [0.5,1])for(let n=0;n<48;n++)this.poseAngles(walkPose(base,params,amplitude,n/48));}
  state(config=false) {
    const state={protocol:PROTOCOL,active:this.active,moving:this.transition!==null||this.walk!==null||this.arming!==null,arming:this.arming!==null,queued:this.queued!==null,mid_step:this.midStep,walking:this.walk&&{gait:this.walk.gait,blending:!!this.walk.blend,stopping_to_pose:!!this.walk.endBase,direction:this.walk.direction,target:this.walk.target,stride:this.walk.stride,lift:this.walk.lift,hip_swing:this.walk.hipSwing,period:this.walk.period,cycle:this.walk.cycle,stopping:this.walkStopping()},positions:this.current,angles:this.angles,released:[...this.released].sort(),joint_limits:this.jointLimits,offsets:this.offsets,
      calibration:{leg:this.calLeg,holding:this.calHolding,reference:[0,175,70],max_adjustment:15,targets:this.calTargets()},power:null,simulated:true};
    if(config)Object.assign(state,{features:['glide','gait_blend','stop_to_pose','resume'],names:NAMES,home:home(70),limits:clone(LIMITS),hard_joint_limits:HARD_JOINT_LIMITS,channels:NAMES.map((_,i)=>[0,1,2].map(j=>i*3+j))});
    return state;
  }
  // One leg's corrected angles at the reference pose, as on the board.
  legAngles(leg,offsets=this.offsets){return this.poseAngles(home(70),offsets)[leg];}
  calTargets(){if(this.calLeg===null)return null;try{return this.legAngles(this.calLeg);}catch{return null;}}
  calSelected(){if(this.calLeg===null)throw new Error('Select a leg to calibrate first');if(this.transition)throw new Error('Wait for this pose to finish, or pause it');return this.calLeg;}
  leg(value){if(!Number.isInteger(value)||value<0||value>5)throw new Error('Leg must be 0..5');return value;}
  handle(request) {
    const op=request.op;
    if(['hello','status','ping'].includes(op)){}
    else if(op==='arm'){
      if(this.walk)throw new Error('Stop walking first');
      if(this.transition||this.arming)throw new Error('Pause the current movement first');
      if(request.glide_ms===undefined){this.current=home(70);this.angles=this.poseAngles(this.current);}
      else this.armGently(request.glide_ms);
      this.active=true;this.released.clear();this.calHolding=false;this.midStep=false;
    } else if(op==='pose'){
      if(!this.active||!this.current)throw new Error('Enable at home before sending movement');
      if(this.walk)throw new Error('Stop walking first');
      const queue=request.queue===true;
      if(this.transition&&!queue)throw new Error('Wait for this pose to finish, or pause it');
      if(queue&&this.queued)throw new Error('A pose is already queued');
      const duration=request.duration_ms,mode=request.ease??'linear';
      if(!Number.isInteger(duration)||duration<MIN_DURATION||duration>MAX_DURATION)throw new Error(`Duration must be ${MIN_DURATION}..${MAX_DURATION} milliseconds`);
      if(!['linear','smooth'].includes(mode))throw new Error('Ease must be linear or smooth');
      const target=request.positions;this.poseAngles(target);
      // A queued pose starts where the current transition ends.
      const start=this.transition?this.transition.target:this.current,steps=interpolationSteps(duration);
      for(let step=1;step<=steps;step++)this.poseAngles(blend(start,target,step/steps));
      const motion={start:clone(start),target:clone(target),duration,steps,ease:mode,started:this.now(),last:0};
      if(this.transition)this.queued=motion;else this.transition=motion;
      this.midStep=false;
    } else if(op==='walk'){
      const walk=this.walk;
      if(walk){
        // Steer and/or change settings; anything left out keeps its value.
        // A walk that is slowing down can carry on ('resume': true) without a full stop.
        const resuming=this.walkStopping();
        if(resuming&&request.resume!==true)throw new Error('The walk is stopping');
        const gait=request.gait??walk.gait;
        if(!Object.hasOwn(WALK_GAITS,gait))throw new Error('Gait must be tripod, ripple or wave');
        const params={gait,direction:request.direction??walk.target,stride:request.stride??walk.goal.stride,lift:request.lift??walk.goal.lift,hipSwing:request.hip_swing??walk.goal.hipSwing,period:request.period_ms??walk.period};
        validateWalk(params);
        const base=resuming?this.stopBase(walk,walk.cycle):walk.base;this.checkWalk(base,params);
        if(resuming){walk.ramp={from:this.walkAmp(walk,walk.cycle),start:walk.cycle};walk.base=clone(base);walk.endBase=null;walk.stopAt=null;}
        walk.target=[...params.direction];walk.goal={stride:params.stride,lift:params.lift,hipSwing:params.hipSwing};walk.period=params.period;
        if(gait!==walk.gait)this.blendGait(walk,gait);
      } else {
        const params={gait:request.gait,direction:request.direction,stride:request.stride,lift:request.lift,hipSwing:request.hip_swing??0,period:request.period_ms,cycles:request.cycles??0};
        validateWalk(params);
        if(!this.active||!this.current)throw new Error('Enable at home before walking');
        if(this.midStep)throw new Error('The last walk stopped mid-step; press Stand (or send a pose) before walking again');
        if(this.transition)throw new Error('Wait for this pose to finish, or pause it');
        const base=clone(this.current);this.checkWalk(base,params);
        this.walk={...params,base,blend:null,endBase:null,ramp:null,direction:[...params.direction],target:[...params.direction],goal:{stride:params.stride,lift:params.lift,hipSwing:params.hipSwing},cycle:0,lastTime:this.now(),stopAt:params.cycles?WALK_RAMP+params.cycles:null};
      }
    } else if(op==='walk_stop'){
      const walk=this.walk;
      if(walk){
        if(request.positions!==undefined){
          if(this.walkStopping())throw new Error('The walk is already stopping');
          this.poseAngles(request.positions);this.checkStopTo(walk,request.positions);walk.endBase=clone(request.positions);
        }
        if(walk.stopAt===null||walk.cycle<walk.stopAt)walk.stopAt=walk.cycle;
      }
    }
    else if(op==='pause')this.stopMotion();
    else if(op==='off'){this.stopMotion();this.active=false;this.released.clear();this.calHolding=false;}
    else if(op==='cal_select'){const leg=this.leg(request.leg);this.stopMotion();this.active=false;this.released.clear();this.calHolding=false;this.calLeg=leg;}
    else if(op==='cal_move'){const leg=this.calSelected();this.legAngles(leg);this.active=true;this.calHolding=true;this.released=new Set([0,1,2,3,4,5].filter(i=>i!==leg));this.current=null;this.angles=null;}
    else if(op==='cal_adjust'){
      const leg=this.calSelected(),{joint,delta}=request;
      if(this.active&&!this.calHolding)throw new Error('Motors are enabled for movement; disable them or select the leg again before calibrating');
      if(!Number.isInteger(joint)||joint<0||joint>2||!number(delta)||Math.abs(delta)>15)throw new Error('Use joint 0..2 and a change of -15..15 degrees');
      const updated=clone(this.offsets);updated[leg][joint]+=delta;this.legAngles(leg,updated);this.offsets=updated;
    } else if(op==='cal_save')this.savedOffsets=clone(this.offsets);
    else if(op==='release_leg'){const leg=this.leg(request.leg);this.stopMotion();this.released.add(leg);this.current=null;}
    else if(op==='jog_joint'){
      if(!this.active||!this.angles)throw new Error('Enable at home before testing a joint');
      if(this.transition)throw new Error('Wait for this pose to finish, or pause it');
      const leg=this.leg(request.leg),{joint,angle}=request;
      if(this.released.has(leg))throw new Error(`${NAMES[leg]} is released; Enable at home first`);
      if(!Number.isInteger(joint)||joint<0||joint>2)throw new Error('Joint must be 0 (hip), 1 (upper leg) or 2 (lower leg)');
      const [low,high]=HARD_JOINT_LIMITS[joint];
      if(!number(angle)||angle<low||angle>high)throw new Error(`Test angle must be within ${low}..${high}`);
      if(Math.abs(angle-this.angles[leg][joint])>10)throw new Error('Test angles move at most 10 deg per step');
      this.angles[leg][joint]=angle;this.current=null;
    } else if(op==='set_joint_limits'){
      if(this.transition)throw new Error('Wait for this pose to finish, or pause it');
      const limits=request.joint_limits;
      if(!Array.isArray(limits)||limits.length!==3||!limits.every((p,j)=>Array.isArray(p)&&p.length===2&&p.every(number)&&HARD_JOINT_LIMITS[j][0]<=p[0]&&p[0]<p[1]&&p[1]<=HARD_JOINT_LIMITS[j][1]))
        throw new Error('Joint limits must be ordered and within -180..180');
      if(this.active&&this.angles)this.angles.forEach((values,leg)=>values.forEach((value,joint)=>{
        if(!this.released.has(leg)&&(value<limits[joint][0]||value>limits[joint][1]))throw new Error(`${NAMES[leg]} ${JOINT_NAMES[joint]} is at ${value.toFixed(1)} deg, outside the new limits; move it first`);
      }));
      this.jointLimits=clone(limits);
    } else throw new Error('Unknown training command');
    return this.state(['hello','set_joint_limits'].includes(op));
  }
}
