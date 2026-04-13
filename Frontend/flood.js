import { LAMBDA_URL } from './app.js';

// =======================================================
// Testing
// =======================================================
const FLOOD_DELAY = 10;

export const CLASSROOM = [
  // Diligent (3 students) — always complete and pass
  { name: "Alice Johnson",    email: "alice@test.com",      type: "diligent" },
  { name: "Bob Smith",        email: "bob@test.com",        type: "diligent" },
  { name: "Carol White",      email: "carol@test.com",      type: "diligent" },
  
  // Average (3) — mixed results
  { name: "David Brown",      email: "david@test.com",      type: "average" },
  { name: "Emma Davis",       email: "emma@test.com",       type: "average" },
  { name: "Felix Zhang",      email: "felix@test.com",      type: "average" },

  // Passive (2) — rarely complete, usually fail
  { name: "Georgia Lee",      email: "georgia@test.com",    type: "passive" },
  { name: "Hassan Ali",       email: "hassan@test.com",     type: "passive" },

  // Dropout (2) — attempt once, terminate, never return
  { name: "Isabel Taylor",    email: "isabel@test.com",     type: "dropout" },
  { name: "James Anderson",   email: "james@test.com",      type: "dropout" },

  // Exhaustive (3) — abnormally high interactions, mixed good/bad
  { name: "Karen Martinez",   email: "karen@test.com",      type: "exhaustive" },
  { name: "Liam O'Brien",     email: "liam@test.com",       type: "exhaustive" },
  { name: "Maya Patel",       email: "maya@test.com",       type: "exhaustive" },

  // Effective (2) — attempt + complete, minimal interactions
  { name: "Nathan Chen",      email: "nathan@test.com",     type: "effective" },
  { name: "Olivia Scott",     email: "olivia@test.com",     type: "effective" },

   // Multiple tries (3) — fail/terminate 1-3 times then pass
  { name: "Pedro Silva",      email: "pedro@test.com",      type: "multiple_tries" },
  { name: "Quinn Murphy",     email: "quinn@test.com",      type: "multiple_tries" },
  { name: "Rachel Kim",       email: "rachel@test.com",     type: "multiple_tries" },

  // Serial dropout (2) — attempt and terminate multiple times, never complete
  { name: "Sam Wilson",       email: "sam@test.com",        type: "serial_dropout" },
  { name: "Tina Nguyen",      email: "tina@test.com",       type: "serial_dropout" }
];

const VERBS = {
  initialized:         "http://adlnet.gov/expapi/verbs/initialized", // video initialized (lognin/stuff, video hasn't been played)
  attempted:           "http://adlnet.gov/expapi/verbs/attempted", // video is played
  played:              "https://w3id.org/xapi/video/verbs/played", // video is resumed
  paused:              "https://w3id.org/xapi/video/verbs/paused", // video is paused
  seeked:              "https://w3id.org/xapi/video/verbs/seeked", // move to a certian part of the future
  interacted:          "http://adlnet.gov/expapi/verbs/interacted", // specific interractions (mute, unmute, fullscreen, exit-fullscreen)
  answered:            "http://adlnet.gov/expapi/verbs/answered", // answered a question (FIXME: Add Pass/fail later)
  terminated:          "https://w3id.org/xapi/video/verbs/terminated", // video exited/terminated wihout finishing it
  completed:           "http://adlnet.gov/expapi/verbs/completed", // video is completed (when there is no pass threshold)
  passed:              "http://adlnet.gov/expapi/verbs/passed", // video completed while exceeding pass threshold
  failed:              "http://adlnet.gov/expapi/verbs/failed" // video completed without exceeding pass threshold
};

export async function floodDatabase() {
  // Fetch test video from backend
  const response = await fetch(`${LAMBDA_URL}/videos?test=true`);
  const data = await response.json();
  const testVideos = (data.data ?? []).filter(v => v.status === 1);
  
  if (testVideos.length === 0) {
    display.textContent = "No test videos found.";
    return;
  }
  console.log("Test Videos: ", testVideos);

  // Start simulation
 console.log("Exhaustive Flood Started");

  for (const student of CLASSROOM) {
    for (const video of testVideos) {
      switch (student.type) {
        case "diligent":       await simulateDiligent(student, video);       break;
        case "average":        await simulateAverage(student, video);        break;
        case "passive":        await simulatePassive(student, video);        break;
        case "dropout":        await simulateDropout(student, video);        break;
        case "exhaustive":     await simulateExhaustive(student, video);     break;
        case "effective":      await simulateEffective(student, video);      break;
        case "multiple_tries": await simulateMultiTry(student, video);       break;
        case "serial_dropout": await simulateSerialDropout(student, video);  break;
      }
    }
  }

  console.log("Exhaustive Flood Completed");
}


// =======================================================
// Core sender
// =======================================================
async function sendTestStatement(actor, verbId, video, timestamp, result = null, extensions = {}, time = null) {
  const fullExtensions = time !== null
    ? { ...extensions, "https://w3id.org/xapi/video/extensions/time": time }
    : extensions;

  const body = {
    actor,
    verbId,
    videoId: video.id,
    timestamp,
    extensions: fullExtensions,
    ...(result && { result })
  };

  return fetch(`${LAMBDA_URL}/statements?test=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  .then(res => res.json())
}


// =======================================================
// Shared helpers
// =======================================================
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function randomTimestamp(weeksAgo = 3) {
  const now  = Date.now();
  const range = weeksAgo * 7 * 24 * 60 * 60 * 1000;
  return new Date(now - Math.random() * range).toISOString();
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInteractionType() {
  return randomChoice(["mute", "unmute", "fullscreen", "exit-fullscreen"]);
}

function makeAnswerResult(correct, q) {
  const correctId = q?.definition?.correctResponsesPattern?.[0] ?? "correct-answer";
  const wrongIds  = (q?.definition?.choices ?? []).map(c => c.id).filter(id => id !== correctId);
  const responseId = correct
    ? correctId
    : (wrongIds.length ? randomChoice(wrongIds) : "wrong-answer");

  return {
    success:  correct,
    response: responseId,
    duration: `PT${rand(2, 30)}S`
  };
}

/** Returns true if the student passed, based on questions and passThreshold. */
function didPass(video, correctCount) {
  const questions = Object.values(video.questions ?? {});
  if (questions.length === 0 || video.passThreshold === 0) return null;
  return correctCount >= video.passThreshold;
}

/** Build the actor object from a student. */
function makeActor(student) {
  return { objectType: "Agent", name: student.name, mbox: `mailto:${student.email}` };
}

/** Fire a random scatter of pauses, plays, seeks and interactions up to maxEvents. */
async function randomMiddle(actor, video, ts, currentTime, videoLength, maxEvents = 4) {
  const count = Math.floor(Math.random() * maxEvents) + 1;
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    if (roll < 0.3) {
      // pause → resume
      const pauseAt = Math.min(currentTime + rand(10, 60), videoLength);
      await sendTestStatement(actor, VERBS.paused, video, ts(), null, {}, pauseAt);
      await delay(FLOOD_DELAY);
      await sendTestStatement(actor, VERBS.played, video, ts(), null, {}, pauseAt);
      await delay(FLOOD_DELAY);
      currentTime = pauseAt;
    } else if (roll < 0.55) {
      // seek
      const seekTo = Math.min(currentTime + rand(5, 120), videoLength);
      await sendTestStatement(actor, VERBS.seeked, video, ts(), null, {
        "https://w3id.org/xapi/video/extensions/time-from": currentTime,
        "https://w3id.org/xapi/video/extensions/time-to":   seekTo
      }, seekTo);
      await delay(FLOOD_DELAY);
      currentTime = seekTo;
    } else {
      // interact
      await sendTestStatement(actor, VERBS.interacted, video, ts(), null, {
        "https://w3id.org/xapi/video/extensions/interaction-type": randomInteractionType()
      }, currentTime);
      await delay(FLOOD_DELAY);
    }
  }
  return currentTime;
}

async function answerQuestions(actor, video, ts, correctOverride = null) {
  const questions    = Object.entries(video.questions ?? {});
  let   correctCount = 0;

  for (const [questionId, q] of questions) {
    const correct = correctOverride !== null ? correctOverride : Math.random() > 0.5;
    if (correct) correctCount++;

    const body = {
      actor,
      verbId:     VERBS.answered,
      videoId:    video.id,
      questionId,
      timestamp:  ts(),
      result:     makeAnswerResult(correct, q),
      extensions: {}
    };

    await fetch(`${LAMBDA_URL}/statements?test=true`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body)
    }).then(r => r.json());

    await delay(FLOOD_DELAY);
  }
  return correctCount;
}

/** Fire the terminal verb (completed / passed / failed) then terminated. */
async function finishVideo(actor, video, ts, correctCount) {
  await sendTestStatement(actor, VERBS.completed, video, ts());
  await delay(FLOOD_DELAY);
  if (video.passThreshold > 0) {
    const passed = didPass(video, correctCount);
    await sendTestStatement(actor, passed ? VERBS.passed : VERBS.failed, video, ts());
    await delay(FLOOD_DELAY);
  }

  await sendTestStatement(actor, VERBS.terminated, video, ts());
  await delay(FLOOD_DELAY);
}


// =======================================================
// Student simulators
// =======================================================

/** Diligent — always initializes, watches fully, answers correctly, always passes. */
async function simulateDiligent(student, video) {
  const actor      = makeActor(student);
  const ts         = () => randomTimestamp(3);
  const videoLength = video.videoLength ?? 600;

  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.attempted,   video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.played,      video, ts(), null, {}, 0);
  await delay(FLOOD_DELAY);

  await randomMiddle(actor, video, ts, 0, videoLength, rand(2, 4));

  const correctCount = await answerQuestions(actor, video, ts, true); // always correct

  await finishVideo(actor, video, ts, correctCount);
}

/** Average — watches, randomly passes or fails questions, may or may not complete. */
async function simulateAverage(student, video) {
  const actor       = makeActor(student);
  const ts          = () => randomTimestamp(3);
  const videoLength = video.videoLength ?? 600;

  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.attempted,   video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.played,      video, ts(), null, {}, 0);
  await delay(FLOOD_DELAY);

  await randomMiddle(actor, video, ts, 0, videoLength, rand(1, 4));

  const correctCount = await answerQuestions(actor, video, ts, null); // random

  if (Math.random() > 0.25) {
    await finishVideo(actor, video, ts, correctCount);
  } else {
    // Drops out before finishing
    await sendTestStatement(actor, VERBS.terminated, video, ts());
  }
}

/** Passive — may skip attempt altogether; sparse interactions; usually fails or terminates. */
async function simulatePassive(student, video) {
  const actor       = makeActor(student);
  const ts          = () => randomTimestamp(3);
  const videoLength = video.videoLength ?? 600;

  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);

  // 40% chance they never even press play
  if (Math.random() < 0.4) {
    await sendTestStatement(actor, VERBS.terminated, video, ts());
    return;
  }

  await sendTestStatement(actor, VERBS.attempted, video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.played,    video, ts(), null, {}, 0);
  await delay(FLOOD_DELAY);

  // Very sparse middle — 0 or 1 events
  if (Math.random() > 0.5) {
    await randomMiddle(actor, video, ts, 0, videoLength, 1);
  }

  // Usually wrong on questions
  const correctCount = await answerQuestions(actor, video, ts, false);

  if (Math.random() > 0.5) {
    await finishVideo(actor, video, ts, correctCount);
  } else {
    await sendTestStatement(actor, VERBS.terminated, video, ts());
  }
}

/** Dropout — initializes, maybe presses play once, then leaves immediately. */
async function simulateDropout(student, video) {
  const actor = makeActor(student);
  const ts    = () => randomTimestamp(3);

  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);

  if (Math.random() > 0.4) {
    await sendTestStatement(actor, VERBS.attempted, video, ts());
    await delay(FLOOD_DELAY);
    await sendTestStatement(actor, VERBS.played,    video, ts(), null, {}, 0);
    await delay(FLOOD_DELAY);
  }

  await sendTestStatement(actor, VERBS.terminated, video, ts());
}

/** Exhaustive — abnormally high interactions (8-12), mixed answers, mixed outcome. */
async function simulateExhaustive(student, video) {
  const actor       = makeActor(student);
  const ts          = () => randomTimestamp(3);
  const videoLength = video.videoLength ?? 600;

  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.attempted,   video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.played,      video, ts(), null, {}, 0);
  await delay(FLOOD_DELAY);

  // Abnormally high interaction count
  await randomMiddle(actor, video, ts, 0, videoLength, rand(8, 12));

  // Mixed correct/wrong
  const correctCount = await answerQuestions(actor, video, ts, null);

  await finishVideo(actor, video, ts, correctCount);
}

/** Effective — minimal interactions; watches start to finish; always answers correctly. */
async function simulateEffective(student, video) {
  const actor = makeActor(student);
  const ts    = () => randomTimestamp(3);

  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.attempted,   video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.played,      video, ts(), null, {}, 0);
  await delay(FLOOD_DELAY);

  // No random middle — straight through
  const correctCount = await answerQuestions(actor, video, ts, true);

  await finishVideo(actor, video, ts, correctCount);
}

/** Multiple tries — fails/terminates 1-3 times, then passes on the final attempt. */
async function simulateMultiTry(student, video) {
  const actor       = makeActor(student);
  const ts          = () => randomTimestamp(3);
  const videoLength = video.videoLength ?? 600;
  const tries       = rand(1, 3);

  for (let attempt = 0; attempt < tries; attempt++) {
    await sendTestStatement(actor, VERBS.initialized, video, ts());
    await delay(FLOOD_DELAY);
    await sendTestStatement(actor, VERBS.attempted,   video, ts());
    await delay(FLOOD_DELAY);
    await sendTestStatement(actor, VERBS.played,      video, ts(), null, {}, 0);
    await delay(FLOOD_DELAY);

    await randomMiddle(actor, video, ts, 0, videoLength, rand(1, 3));

    // Deliberately answer wrong on every attempt before the last
    await answerQuestions(actor, video, ts, false);

    // Fail or terminate mid-way
    if (Math.random() > 0.5) {
      await sendTestStatement(actor, VERBS.completed, video, ts());
      await delay(FLOOD_DELAY);
      await sendTestStatement(actor, VERBS.failed,    video, ts());
    } else {
      await sendTestStatement(actor, VERBS.terminated, video, ts());
    }
    await delay(FLOOD_DELAY);
  }

  // Final successful attempt
  await sendTestStatement(actor, VERBS.initialized, video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.attempted,   video, ts());
  await delay(FLOOD_DELAY);
  await sendTestStatement(actor, VERBS.played,      video, ts(), null, {}, 0);
  await delay(FLOOD_DELAY);

  await randomMiddle(actor, video, ts, 0, videoLength, rand(1, 3));

  const correctCount = await answerQuestions(actor, video, ts, true);

  await finishVideo(actor, video, ts, correctCount);
}

/** Serial dropout — attempts and immediately terminates 2-4 times, never completes. */
async function simulateSerialDropout(student, video) {
  const actor    = makeActor(student);
  const ts       = () => randomTimestamp(3);
  const dropouts = rand(2, 4);

  for (let attempt = 0; attempt < dropouts; attempt++) {
    await sendTestStatement(actor, VERBS.initialized, video, ts());
    await delay(FLOOD_DELAY);

    // Sometimes doesn't even press play
    if (Math.random() > 0.35) {
      await sendTestStatement(actor, VERBS.attempted, video, ts());
      await delay(FLOOD_DELAY);
      await sendTestStatement(actor, VERBS.played,    video, ts(), null, {}, 0);
      await delay(FLOOD_DELAY);

      // Brief seek before bailing
      if (Math.random() > 0.5) {
        const seekTo = Math.random() * 60;
        await sendTestStatement(actor, VERBS.seeked, video, ts(), null, {
          "https://w3id.org/xapi/video/extensions/time-from": 0,
          "https://w3id.org/xapi/video/extensions/time-to":   seekTo
        }, seekTo);
        await delay(FLOOD_DELAY);
      }
    }

    await sendTestStatement(actor, VERBS.terminated, video, ts());
    await delay(FLOOD_DELAY);
  }
}


// =======================================================
// Utilities
// =======================================================
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}