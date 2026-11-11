// Lesson cards for follow-the-teacher mode. Each step opens a page (and camera view) on every
// student's device; a step may ask a quick question, answered anonymously.
// question: {id, text, options, answer (index of the right option), why}
export const LESSONS = [
  {id: 'walking', title: 'How a six-legged robot walks', steps: [
    {page: 'live', view: 'top', title: 'Watch the feet', text: 'Bright feet are in the air, dark feet are pushing on the ground. Watch the top view for a few steps. Which legs lift together?'},
    {page: 'live', view: 'top', title: 'Tripod gait', text: 'The teacher presses Menu until the gait is tripod. Three legs lift at once: front and back on one side, the middle leg on the other.',
      question: {id: 'walking-tripod', text: 'In the tripod gait, how many feet are on the ground at once?', options: ['2', '3', '4', '6'], answer: 1, why: 'Three feet always make a triangle under the body, so it cannot tip over.'}},
    {page: 'live', view: 'angled', title: 'Balance', text: 'The dashed area joins the feet on the ground. The robot is stable while the crosshair (its centre) stays inside it.',
      question: {id: 'walking-stable', text: 'Which gait keeps the most feet on the ground?', options: ['Tripod', 'Ripple', 'Wave'], answer: 2, why: 'Wave lifts one leg at a time, so five feet are always down: slow but very stable.'}},
    {page: 'live', view: 'side', title: 'Step height', text: 'Watch the side view while the teacher presses RB a few times. The feet lift higher, but the body stays at the same height.'},
  ]},
  {id: 'signal', title: 'From a button to a motor', steps: [
    {page: 'how', title: 'Follow one command', text: 'Press a button on the controller and watch the dots: each one is a real message on its way to the motors.'},
    {page: 'how', title: 'The serial wires', text: 'The Pi and the Servo 2040 are joined by three wires: transmit, receive and ground.',
      question: {id: 'signal-uart', text: 'How do commands travel from the Raspberry Pi to the Servo 2040?', options: ['Bluetooth', 'Wi-Fi', 'UART serial wires', 'USB'], answer: 2, why: 'A UART link: short wires carrying one bit at a time, 115 200 bits a second.'}},
    {page: 'how', title: 'Pulses for the servos', text: 'The Servo 2040 tells each servo which angle to hold by the length of a repeating pulse.',
      question: {id: 'signal-pwm', text: 'What does the Servo 2040 send to each servo?', options: ['A number over USB', 'PWM pulses', 'A radio signal', 'Light'], answer: 1, why: 'Pulse-width modulation: a pulse from about 0.5 to 2.5 ms, repeated 50 times a second.'}},
  ]},
  {id: 'kinematics', title: 'Inverse kinematics', steps: [
    {page: 'servos', title: 'Three joints per leg', text: 'Every leg has a hip, an upper-leg and a knee servo. Find them in the picture and in the angle list.',
      question: {id: 'kin-count', text: 'How many servos does the whole robot have?', options: ['6', '12', '18', '24'], answer: 2, why: 'Six legs with three servos each: 18.'}},
    {page: 'servos', title: 'Working backwards', text: 'The board knows where each foot should be, and works out the three angles that put it there. Tap a leg to see the working.'},
    {page: 'servos', title: 'Predict, then test', text: 'Before the teacher presses RB (higher steps): which angles will change the most? Watch the bars.',
      question: {id: 'kin-lift', text: 'Lifting a foot higher mainly changes which joints?', options: ['Only the hip', 'The upper leg and the knee', 'None: the body moves instead'], answer: 1, why: 'Raising a foot bends the leg upwards: the upper leg lifts and the knee bends. The hip only swings the leg forwards and back.'}},
  ]},
  {id: 'care', title: 'Looking after a robot', steps: [
    {page: 'health', title: 'Is anything wrong?', text: 'The Health page checks the battery, the power supply, the controller and the links every few seconds. Green is fine, amber needs attention, red means act now.',
      question: {id: 'care-watchdog', text: 'What does the Servo 2040 do if the Pi stops sending commands for 3 seconds?', options: ['Keeps walking', 'Sits down slowly', 'Switches the motors off', 'Restarts the Pi'], answer: 2, why: 'A watchdog: no news for 3 seconds means something is wrong, so the motors are released.'}},
    {page: 'care', title: 'Which servos work hardest?', text: 'Servo care adds up every degree each servo turns, and how long it spends near the end of its travel.',
      question: {id: 'care-limit', text: 'Why is it bad for a servo to work near the end of its travel?', options: ['It uses less power', 'It is strained and can hit its end stop', 'It makes the robot faster'], answer: 1, why: 'At the end of its range a servo strains against its limit, wears faster and can stall.'}},
    {page: 'sessions', title: 'Using the data', text: 'Every session is recorded. Compare the gait scores, and download a session as a spreadsheet file (CSV) to make your own graphs.'},
  ]},
];
export const lessonById = id => LESSONS.find(l => l.id === id) || null;
