const hihahoAPICode = 'INSERT_CODE';
const LRS_CONFIGS = {
  scorm: {
    name: "SCORM Cloud",
    homepage: "http://cloud.scorm.com",
    username: "INSERT_USERNAME",
    password: 'INSERT_PASSWORD',
    endpoint: `https://cloud.scorm.com/lrs/INSERT_USERNAME/statements`
  },
  scorm_test: {
    name: "SCORM Cloud (Test)",
    homepage: "http://cloud.scorm.com",
    username: "INSERT_USERNAME",
    password: 'INSERT_PASSWORD',
    endpoint: `https://cloud.scorm.com/lrs/INSERT_USERNAME/statements`
  },
  lrsql: {
    name: "LRSQL",
    homepage: "http://127.0.0.1:8080/",
    username: "INSERT_USERNAME",
    password: 'INSERT_PASSWORD',
    endpoint: 'https://staci-miffiest-clinkingly.ngrok-free.dev'
  }
}
const GOOGLE_CLIENT_ID = "INSERT_ID";
const GOOGLE_CLIENT_SECRET = "INSERT_SECRET";
const ALLOWED_EMAILS = ["INSERT_EMAIL", "INSERT_EMAIL", "INSERT_EMAIL"];
const GOOGLE_REDIRECT_URI = "INSERT REDIRECT URL";
const activeSessions = {};
const CF_CONSUMER_SECRET = 'INSERT_SECRET';
const CF_CONSUMER_KEY = 'INSERT_KEY';
const myDomainName = 'INSERT_DOMAIN_NAME';

// =======================================================
// Handler
// =======================================================
export const handler = async (event) => {
  console.log("Event Recieved.");
  console.log("Event: ", event);
  const { path, method, preflightResponse } = handleCORS(event);
  console.log("Path:", path, "\nMethod:", method, "\nPreflight CORS: ", preflightResponse);
  if (preflightResponse) return preflightResponse;

  // ── Google Auth route ─────────────────────────────────
  if (path.endsWith("/auth/google") && method === "POST") {
    return await handleGoogleAuth(event);
  }

  // ── Session validation route ──────────────────────────
  if (path.endsWith("/auth/validate") && method === "GET") {
    return await handleValidateSession(event);
  }

  if (path.endsWith("/auth/logout") && method === "POST") {
    const sessionToken = event.headers?.["x-session-token"];
    if (sessionToken && activeSessions[sessionToken]) {
      delete activeSessions[sessionToken];
    }
    return corsResponse(200, { success: true });
  } 

  // ── Video list route ──────────────────────────────────
  const isTest = event.queryStringParameters?.test === "true";
  console.log("isTest:", isTest);
  const videoListResult = isTest ? await fetchTestVideoData(path) : await fetchHihahoVideoData(path);
  if (videoListResult) return videoListResult;

  // ── Statements route ──────────────────────────────────
  if (path.endsWith("/statements")) {
    // GET — retrieve statements from LRS
    if (method === "GET") return await getStatements(event);

    // POST — assemble and send xAPI statement
    if (method === "POST") {
      const body = JSON.parse(event.body);

      // ── Session check ───────────────────────────────
      const sessionToken = event.headers?.["x-session-token"];
      if (sessionToken) {
        const session = activeSessions[sessionToken];
        if (!session) {
          return corsResponse(401, { error: "Invalid or expired session" });
        }
        if (Date.now() > session.expiresAt) {
          delete activeSessions[sessionToken];
          return corsResponse(401, { error: "Session expired" });
        }
      }

      const lrsKey = isTest ? "scorm_test" : (body.lrs ?? "scorm");
      const lrs = getActiveLRS(lrsKey);

      const { videoTitle, videoDescription, videoURL, objectId, objectDefinition } = isTest
        ? getTestVideoData(body)       // look up from testVideos array
        : await getHihahoVideoData(body.videoId);    // fetch from Hihaho API

      const statement = assembleStatement(body, videoTitle, videoDescription, videoURL, objectId, objectDefinition, lrs);

      return await sendStatement(statement, lrs);
    }
  }

  if (path.endsWith("/salesforce/leads") && method === "GET") {
    return await retrieveAllSalesforceLeads();
  }
  if (path.endsWith("/salesforce/leads") && method === "POST") {
    return await forwardAtRiskStudentsToSalesforce(event);
  }

  return corsResponse(404, { error: "Unknown endpoint" });
};


// =======================================================
// Google Auth
// =======================================================
// Exchanges Google auth code for tokens, verifies identity, creates session
// Input: event with { code, codeVerifier } in body
// Output: { success, sessionToken, email, name }
async function handleGoogleAuth(event) {
  // Clean up expired sessions
  for (const [token, session] of Object.entries(activeSessions)) {
    if (Date.now() > session.expiresAt) delete activeSessions[token];
  }

  try {
    const { code, codeVerifier } = JSON.parse(event.body);
    if (!code || !codeVerifier) {
      return corsResponse(400, { error: "Missing code or codeVerifier" });
    }

    // Exchange auth code + verifier for tokens (PKCE)
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_REDIRECT_URI,
        code,
        code_verifier: codeVerifier
      }).toString()
    });

    const tokenData = await tokenRes.json();
    console.log("Token exchange status:", tokenRes.status);

    if (!tokenData.id_token) {
      return corsResponse(401, { error: `Token exchange failed: ${JSON.stringify(tokenData)}` });
    }

    // Verify the ID token with Google
    const verifyRes  = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${tokenData.id_token}`
    );
    const googleData = await verifyRes.json();

    // Confirm token was issued for your app
    if (googleData.aud !== GOOGLE_CLIENT_ID) {
      return corsResponse(401, { error: "Token audience mismatch" });
    }

    // Check against email whitelist
    if (!ALLOWED_EMAILS.includes(googleData.email)) {
      return corsResponse(403, { error: "Email not authorised" });
    }

    // Create session
    const sessionToken = crypto.randomUUID();
    activeSessions[sessionToken] = {
      email:     googleData.email,
      name:      googleData.name,
      expiresAt: Date.now() + (8 * 60 * 60 * 1000) // 8 hours
    };
    console.log(`Session created for ${googleData.email}`);

    return corsResponse(200, {
      success:      true,
      sessionToken,
      email:        googleData.email,
      name:         googleData.name
    });

  } catch (err) {
    console.error("Google auth error:", err);
    return corsResponse(500, { error: err.message });
  }
}

// Validates an existing session token
// Input: x-session-token header
// Output: { valid, email, name }
async function handleValidateSession(event) {
  const sessionToken = event.headers?.["x-session-token"];
  if (!sessionToken) return corsResponse(400, { error: "No session token provided" });

  const session = activeSessions[sessionToken];
  if (!session)              return corsResponse(401, { valid: false, error: "Invalid session" });
  if (Date.now() > session.expiresAt) {
    delete activeSessions[sessionToken];
    return corsResponse(401, { valid: false, error: "Session expired" });
  }

  return corsResponse(200, {
    valid: true,
    email: session.email,
    name:  session.name
  });
}


// =======================================================
// CORS
// =======================================================
// Retrieves path and method of a fetch request
// Input: event
// Output: { path, method, preflightResponse }
function handleCORS(event) {
  const path   = event.requestContext?.http?.path   ?? "";
  const method = event.requestContext?.http?.method ?? "";

  if (method === "OPTIONS") {
    return {
      path,
      method,
      preflightResponse: corsResponse(200, {})
    };
  }

  return { path, method, preflightResponse: null };
}

// Constructs a CorsResponse based on the status code and aditional information
// Input: statusCode, bodyObject
// Output: CorsResponse
function corsResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-session-token",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
    },
    body: JSON.stringify(bodyObj)
  };
}

// =======================================================
// Hihaho API
// =======================================================
// Fetches a list of videos from the Hihaho API
// Input: URL path
// Output: Array of videos
async function fetchHihahoVideoData(path) {
  if (!path.endsWith("/videos")) return null;

  const response = await fetch("https://api.hihaho.com/v2/video", {
    headers: {
      "Authorization": `Bearer ${hihahoAPICode}`,
      "Content-Type": "application/json"
    }
  });
  const data = await response.json();
  return corsResponse(200, data);
}

// Returns the test videos in the backend
// Input: URL path
// Output: Array of fake videos
async function fetchTestVideoData(path){
  if (!path.endsWith("/videos")) return null;
  return corsResponse(200, testVideos);
}

// Gets the video data of a specific video based on the videoID provided in the event body
// Input: videoID for retrieval
// Output: JSON of video information
async function getHihahoVideoData(videoId) {
  try {
    const response = await fetch(`https://api.hihaho.com/v2/video/${videoId}`, {
      headers: { "Authorization": `Bearer ${hihahoAPICode}` }
    });
    const rawText  = await response.text();
    const videoData = JSON.parse(rawText);
    return {
      videoTitle:       videoData.data?.display_name ?? "Unknown Video",
      videoDescription: videoData.data?.description  ?? "",
      videoURL:         videoData.data?.embed_url     ?? "Unknown URL"
    };
  } catch (err) {
    console.log("Failed to fetch video metadata:", err);
    return {
      videoTitle:       "Unknown Video",
      videoDescription: "",
      videoURL:         "Unknown URL"
    };
  }
}

// Gets the video data of a specific test video based on the videoID provided in the event body
// Input: videoID for retrieval
// Output: JSON of video information
function getTestVideoData(body) {
  const video = testVideos.data.find(v => v.id === body.videoId);
  if (!video) return {
    videoTitle:       "Unknown Video",
    videoDescription: "",
    videoURL:         "",
    objectId:         null,
    objectDefinition: null
  };

  // For answered verb, find the matching question by its activityId
  const isAnswered = body.verbId === "http://adlnet.gov/expapi/verbs/answered";
  if (isAnswered && body.questionId) {
    const question = video.questions?.[body.questionId];
    return {
      videoTitle:       video.display_name,
      videoDescription: video.display_name,
      videoURL:         video.embed_url,
      objectId:         question?.activityId  ?? video.embed_url,
      objectDefinition: question?.definition  ?? null
    };
  }

  return {
    videoTitle:       video.display_name,
    videoDescription: video.display_name,
    videoURL:         video.embed_url,
    objectId:         null,
    objectDefinition: null
  };
}

// =======================================================
// Set LRS
// =======================================================
function getActiveLRS(lrsKey) {
  const key = lrsKey ?? "scorm";
  return LRS_CONFIGS[key] ?? LRS_CONFIGS.scorm;
}

// =======================================================
// xAPI Statement
// =======================================================
// FIXME: Since we have the vide data here, instead of asking the frontend to send it to us, we can just pull it based on UUID/ID
function assembleStatement(body, videoTitle, videoDescription, videoURL, objectId, objectDefinition, lrs) {
  const isAnswered = body.verbId === "http://adlnet.gov/expapi/verbs/answered";

  return {
    id:      crypto.randomUUID(),
    actor:   body.actor,
    verb:    { id: body.verbId },
    ...(body.result && { result: body.result }),
    context: {
        "platform": "Interactive video via hihaho",
        "language": "en-US",
        ...(Object.keys(body.extensions ?? {}).length > 0 && {
          extensions: body.extensions
        })
    },
    timestamp: body.timestamp ?? new Date().toISOString(),
    stored: body.stored ?? new Date().toISOString(),
    authority: {
        "objectType": "Agent",
        "account": {
            "homePage": `${lrs.homepage}`,
            "name": `${lrs.username}`
        }
    },
    version: "1.0.0",
    object: isAnswered
      ? {
          // For answered: use the question activityId + its full definition
          objectType: "Activity",
          id:         body.objectId ?? videoURL,
          definition: body.objectDefinition ?? {
            name:        { "en-US": videoTitle },
            description: { "en-US": videoDescription },
            type:        "http://adlnet.gov/expapi/activities/cmi.interaction"
          }
        }
      : {
          // For all other verbs: use the video URL + video definition
          objectType: "Activity",
          id:         videoURL,
          definition: {
            name:        { "en-US": videoTitle },
            description: { "en-US": videoDescription },
            type:        "https://w3id.org/xapi/video/activity-type/video"
          }
        }
  };
}

async function sendStatement(statement, lrs) {
  const auth = btoa(`${lrs.username}:${lrs.password}`)

  const lrsResponse = await fetch(lrs.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Experience-API-Version": "1.0.3",
      "Authorization": `Basic ${auth}`
    },
    body: JSON.stringify(statement)
  });

  console.log("SCORM Cloud status:", lrsResponse.status);
  return corsResponse(200, {
    message: `Statement sent! LRS status: ${lrsResponse.status}`
  });
}


// =======================================================
// Salesforce
// =======================================================
async function retrieveBearerToken() {
  const res = await fetch(`https://${myDomainName}.my.salesforce.com/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     CF_CONSUMER_KEY,
      client_secret: CF_CONSUMER_SECRET
    })
  });

  const data = await res.json();
  console.log("Salesforce token response: ", JSON.stringify(data));
  return data;
}

async function retrieveAllSalesforceLeads() {
  console.log("Lead Retrieval");
  const token = await retrieveBearerToken();
  const res = await fetch(`https://${myDomainName}.my.salesforce.com/services/data/v63.0/query?q=SELECT+Id,Name,Email,Description+FROM+Lead`, {
    headers: { "Authorization": `Bearer ${token.access_token}` }
  });
  const data = await res.json();
  console.log("Data: ", data);
  return corsResponse(200, { records: data.records ?? [] });
}

// Shapes an at-risk student into a Salesforce lead object
function createLeadData(student) {
  return {
    "LastName":     student.name,
    "Title":        "Hihaho Viewer",
    "Company":      "Hihaho",
    "Email":        student.actor,
    "Description":  `Risk level: ${student.risk.toUpperCase()}. ` +
                    `Completion rate: ${student.rate}%. ` +
                    `Attempted: ${student.attempts}, ` +
                    `Completed: ${student.completions}, ` +
                    `Failed: ${student.failed}, ` +
                    `Terminated: ${student.terminated}.`
  };
}

async function forwardAtRiskStudentsToSalesforce(event) {
  const body = JSON.parse(event.body);                    // parse the body first
  const students = body.atRiskData ?? [];
  console.log("Students: ", students);

  const existingRes = await retrieveAllSalesforceLeads();
  const existingData = JSON.parse(existingRes.body);      // unwrap corsResponse
  const existingEmails = new Set(existingData.records.map(l => l.Email?.toLowerCase()));
  console.log("Existing Emails: ", existingEmails);

  const token = await retrieveBearerToken();
  let created = 0;
  let skipped = 0;

  for (const student of students) {
    if (existingEmails.has(student.actor)) {
      skipped++;
      continue;
    }

    const leadData = createLeadData(student);
    console.log("New Lead Student Data: ", leadData);
    const sfRes = await fetch(`https://${myDomainName}.my.salesforce.com/services/data/v63.0/sobjects/Lead`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(leadData)
    });
    created++;

    const sfData = await sfRes.json();
    console.log("Salesforce POST response:", JSON.stringify(sfData));
  }

  return corsResponse(200, {message: `Done. ${created} leads created, ${skipped} duplicates skipped.` });
}


// =======================================================
// LRS Retrieval
// =======================================================
async function getStatements(event) {
  const lrsKey = event.queryStringParameters?.lrs ?? "scorm";
  const lrs = getActiveLRS(lrsKey);
  const auth = btoa(`${lrs.username}:${lrs.password}`);

  // Strip lrs param before forwarding to LRS
  const forwardParams = { ...event.queryStringParameters };
  const limit = Math.min(parseInt(forwardParams.limit ?? 100), 4000);
  console.log("Limit: ", limit);
  delete forwardParams.lrs;
  delete forwardParams.test;
  delete forwardParams.limit;
  const baseParams = new URLSearchParams(forwardParams).toString();

  let allFetched = [];
  let nextUrl = `${lrs.endpoint}?${baseParams}&limit=${(limit <= 500) ? limit : 500}`;

  while (nextUrl && allFetched.length < limit){
    const lrsResponse = await fetch(nextUrl, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${auth}`,
        "X-Experience-API-Version": "1.0.3"
      }
    });

    const data = await lrsResponse.json();
    const statements = data.statements ?? [];
    allFetched = allFetched.concat(statements);

    console.log(`Fetched ${statements.length}, total so far: ${allFetched.length}`);
    console.log("All Fetched: ", allFetched);

    // Follow the `more` URL if we still need more results
    if (data.more && allFetched.length < limit) {
      // `more` is a relative path like /statements?cursor=abc
      nextUrl = `${new URL(lrs.endpoint).origin}${data.more}`;
    } else {
      nextUrl = null;
    }

    console.log("Next URL: ", nextUrl);
  }
  const trimmed = allFetched.slice(0, limit);
  console.log(`Returning ${trimmed.length} of ${allFetched.length} fetched`);
  console.log("Trimmed: ", trimmed);

  return corsResponse(200, { statements: trimmed });
}

// ---------------------------------
// testVideos
// ---------------------------------
const testVideos = {
  data: [
    {
      id: "test-001", uuid: "test-001",
      display_name: "Introduction to the Course",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-001",
      videoLength: 180,
      passThreshold: 0,
      questions: {}  // no questions → ends with "completed"
    },
    {
      id: "test-002", uuid: "test-002",
      display_name: "Chapter 1 — Core Concepts",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-002",
      videoLength: 420,
      passThreshold: 1,
      questions: {
        "q-001": {
          activityId: "https://player.hihaho.com/test-002/questions/q-001",
          timeInVideo: 90,         // seconds into the video when the question appears
          definition: {
            name:            { "en-US": "What is the primary concept introduced in Chapter 1?" },
            description:     { "en-US": "What is the primary concept introduced in Chapter 1?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388730"],
            choices: [
              { id: "388730", description: { "en-US": "Abstraction" } },
              { id: "388731", description: { "en-US": "Inheritance" } },
              { id: "388732", description: { "en-US": "Polymorphism" } },
              { id: "388733", description: { "en-US": "Encapsulation" } }
            ]
          }
        }
      }
    },
    {
      id: "test-003", uuid: "test-003",
      display_name: "Chapter 2 — Advanced Topics",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-003",
      videoLength: 540,
      passThreshold: 1,
      questions: {
        "q-002": {
          activityId: "https://player.hihaho.com/test-003/questions/q-002",
          timeInVideo: 120,
          definition: {
            name:            { "en-US": "Which pattern is best suited for this advanced scenario?" },
            description:     { "en-US": "Which pattern is best suited for this advanced scenario?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388734"],
            choices: [
              { id: "388734", description: { "en-US": "Observer" } },
              { id: "388735", description: { "en-US": "Singleton" } },
              { id: "388736", description: { "en-US": "Factory" } },
              { id: "388737", description: { "en-US": "Decorator" } }
            ]
          }
        },
        "q-003": {
          activityId: "https://player.hihaho.com/test-003/questions/q-003",
          timeInVideo: 300,
          definition: {
            name:            { "en-US": "What is the main drawback of tight coupling?" },
            description:     { "en-US": "What is the main drawback of tight coupling?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388738"],
            choices: [
              { id: "388738", description: { "en-US": "Reduced maintainability" } },
              { id: "388739", description: { "en-US": "Faster execution" } },
              { id: "388740", description: { "en-US": "Simpler debugging" } },
              { id: "388741", description: { "en-US": "Better performance" } }
            ]
          }
        }
      }
    },
    {
      id: "test-004", uuid: "test-004",
      display_name: "Chapter 3 — Practical Examples",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-004",
      videoLength: 600,
      passThreshold: 0,
      questions: {
        "q-004": {
          activityId: "https://player.hihaho.com/test-004/questions/q-004",
          timeInVideo: 200,
          definition: {
            name:            { "en-US": "Which of the following is a practical example of the concept?" },
            description:     { "en-US": "Which of the following is a practical example of the concept?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388742"],
            choices: [
              { id: "388742", description: { "en-US": "Using a queue for task scheduling" } },
              { id: "388743", description: { "en-US": "Using a stack for breadth-first search" } },
              { id: "388744", description: { "en-US": "Using recursion for iteration" } },
              { id: "388745", description: { "en-US": "Using globals for state management" } }
            ]
          }
        }
      }
    },
    {
      id: "test-005", uuid: "test-005",
      display_name: "Final Assessment",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-005",
      videoLength: 300,
      passThreshold: 2,
      questions: {
        "q-005": {
          activityId: "https://player.hihaho.com/test-005/questions/q-005",
          timeInVideo: 60,
          definition: {
            name:            { "en-US": "Summarise the key takeaway from the course." },
            description:     { "en-US": "Summarise the key takeaway from the course." },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388746"],
            choices: [
              { id: "388746", description: { "en-US": "Separation of concerns improves scalability" } },
              { id: "388747", description: { "en-US": "More code equals better software" } },
              { id: "388748", description: { "en-US": "Performance always trumps readability" } },
              { id: "388749", description: { "en-US": "Testing is optional for small projects" } }
            ]
          }
        },
        "q-006": {
          activityId: "https://player.hihaho.com/test-005/questions/q-006",
          timeInVideo: 180,
          definition: {
            name:            { "en-US": "Which verb fires when a user completes a video with no pass threshold?" },
            description:     { "en-US": "Which verb fires when a user completes a video with no pass threshold?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388750"],
            choices: [
              { id: "388750", description: { "en-US": "completed" } },
              { id: "388751", description: { "en-US": "passed" } },
              { id: "388752", description: { "en-US": "terminated" } },
              { id: "388753", description: { "en-US": "attempted" } }
            ]
          }
        }
      }
    },
    {
      id: "test-006", uuid: "test-006",
      display_name: "Supplementary Material A",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-006",
      videoLength: 240,
      passThreshold: 0,
      questions: {}  // no questions → ends with "completed"
    },
    {
      id: "test-007", uuid: "test-007",
      display_name: "Supplementary Material B",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-007",
      videoLength: 260,
      passThreshold: 0,
      questions: {}  // no questions → ends with "completed"
    },
    {
      id: "test-008", uuid: "test-008",
      display_name: "Guest Lecture — Industry Insights",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-008",
      videoLength: 720,
      passThreshold: 1,
      questions: {
        "q-007": {
          activityId: "https://player.hihaho.com/test-008/questions/q-007",
          timeInVideo: 360,
          definition: {
            name:            { "en-US": "What industry trend was highlighted by the guest speaker?" },
            description:     { "en-US": "What industry trend was highlighted by the guest speaker?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388754"],
            choices: [
              { id: "388754", description: { "en-US": "AI-driven automation" } },
              { id: "388755", description: { "en-US": "Declining cloud adoption" } },
              { id: "388756", description: { "en-US": "Return to monolithic architecture" } },
              { id: "388757", description: { "en-US": "Reduced focus on security" } }
            ]
          }
        }
      }
    },
    {
      id: "test-009", uuid: "test-009",
      display_name: "Review Session",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-009",
      videoLength: 480,
      passThreshold: 1,
      questions: {
        "q-008": {
          activityId: "https://player.hihaho.com/test-009/questions/q-008",
          timeInVideo: 150,
          definition: {
            name:            { "en-US": "Which topic from the review is most commonly misunderstood?" },
            description:     { "en-US": "Which topic from the review is most commonly misunderstood?" },
            type:            "http://adlnet.gov/expapi/activities/cmi.interaction",
            interactionType: "choice",
            correctResponsesPattern: ["388758"],
            choices: [
              { id: "388758", description: { "en-US": "Async/await execution order" } },
              { id: "388759", description: { "en-US": "Variable declaration" } },
              { id: "388760", description: { "en-US": "Array indexing" } },
              { id: "388761", description: { "en-US": "String concatenation" } }
            ]
          }
        }
      }
    },
    {
      id: "test-010", uuid: "test-010",
      display_name: "Bonus Content",
      status: 1,
      embed_url: "https://test.hihaho.com/video/test-010",
      videoLength: 150,
      passThreshold: 0,
      questions: {}  // no questions → ends with "completed"
    }
  ]
};