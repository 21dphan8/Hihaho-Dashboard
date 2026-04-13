// Test users
const USERS = [
  { name: "Alice Johnson", email: "alice@test.com" },
  { name: "Bob Smith", email: "bob@test.com" },
  { name: "Carol White", email: "carol@test.com" },
  { name: "David Brown", email: "david@test.com" },
  { name: "Emma Davis", email: "emma@test.com" },
  { name: "Frank Miller", email: "frank@test.com" },
  { name: "Grace Wilson", email: "grace@test.com" },
  { name: "Henry Moore", email: "henry@test.com" },
  { name: "Isabel Taylor", email: "isabel@test.com" },
  { name: "James Anderson", email: "james@test.com" }
];

// Verbs to simulate
const VERBS = [
  "http://adlnet.gov/expapi/verbs/attempted",
  "http://adlnet.gov/expapi/verbs/completed",
  "http://adlnet.gov/expapi/verbs/interacted",
  "https://w3id.org/xapi/video/verbs/paused"
];

const VIDEO_ID = "https://player.hihaho.com/embed/24322e42-701d-4d1b-ad9f-d7cca44d86d2?api=true";

const LRS_ENDPOINT = "https://cloud.scorm.com/lrs/YOUR_CODE/statements";
const LRS_USERNAME = "YOUR_USERNAME";
const LRS_PASSWORD = "YOUR_PASSWORD";
const AUTH = Buffer.from(`${LRS_USERNAME}:${LRS_PASSWORD}`).toString("base64");

// Generate a UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Send a single statement
async function sendStatement(user, verbId) {
  const statement = {
    id: generateUUID(),
    version: "1.0.0",
    actor: {
      objectType: "Agent",
      name: user.name,
      mbox: `mailto:${user.email}`
    },
    verb: { id: verbId },
    object: {
      objectType: "Activity",
      id: VIDEO_ID,
      definition: {
        name: { "en-US": "Oil Prices, Iran War, and Mansion Attack" },
        description: { "en-US": "The Trump Oil Prices Situation is Crazy" },
        extensions: {}
      }
    },
    context: {
      platform: "Interactive video via hihaho",
      language: "en-US"
    },
    timestamp: new Date().toISOString()
  };

  const response = await fetch(LRS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Experience-API-Version": "1.0.3",
      "Authorization": `Basic ${AUTH}`
    },
    body: JSON.stringify(statement)
  });

  console.log(`${user.name} — ${verbId.split("/").pop()} → ${response.status}`);
}

// Main function — send statements for all users
async function flood() {
  console.log("Starting flood...\n");

  for (const user of USERS) {
    // Every user attempts the video
    await sendStatement(user, VERBS[0]);

    // Random chance of pausing
    if (Math.random() > 0.3) {
      await sendStatement(user, VERBS[3]);
    }

    // Random chance of interacting
    if (Math.random() > 0.4) {
      await sendStatement(user, VERBS[2]);
    }

    // Random chance of completing (not everyone finishes)
    if (Math.random() > 0.5) {
      await sendStatement(user, VERBS[1]);
    }
  }

  console.log("\nFlood complete!");
}

flood();