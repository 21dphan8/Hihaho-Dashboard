// ----------------- Global Variables -----------------------
// Hihaho API Code - connects the lambda to a hihaho account
const hihahoAPICode = 'INSERT_CODE';

// LRS Configuration - Variousl LRS Endpoint Configurations 
// NOTE 1: LRSQL is nonfunctional, and all configurations assume similar integration to scorm Cloud LRS.
// Diffrerent LRS implementations may require different handling.
// Note 2: "name" and "homepage" is used for descriptive text in statement
// "username", ""password", and "endpoint" are all LRS-specific and must be exact
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

// Google OAuth2
// Note: This only uses the web version of OAuth. Other platforms may not work.
const GOOGLE_CLIENT_ID = "INSERT_ID";
const GOOGLE_CLIENT_SECRET = "INSERT_SECRET";
const ALLOWED_EMAILS = ["INSERT_EMAIL", "INSERT_EMAIL", "INSERT_EMAIL"];
const GOOGLE_REDIRECT_URI = "INSERT REDIRECT URL";
const activeSessions = {};

// Cloudforce
const CF_CONSUMER_SECRET = 'INSERT_SECRET';
const CF_CONSUMER_KEY = 'INSERT_KEY';
const myDomainName = 'INSERT_DOMAIN_NAME';

// ---------------------------- Handler -----------------------------------------------
export const handler = async (event) => {
  const { path, method, preflightResponse } = handleCORS(event);
  console.log("Path:", path, "\nMethod:", method, "\nPreflight CORS: ", preflightResponse);
  if (preflightResponse) return preflightResponse;


  // Google Auth and Session Validation route
  if (path.endsWith("/auth/google") && method === "POST") return await handleGoogleAuth(event);

  if (path.endsWith("/auth/validate") && method === "GET") return await handleValidateSession(event);
  
  if (path.endsWith("/auth/logout") && method === "POST") {
    const sessionToken = event.headers?.["x-session-token"];
    if (sessionToken && activeSessions[sessionToken]) {
      delete activeSessions[sessionToken];
    }
    return corsResponse(200, { success: true });
  }


  // Video list route
  const isTest = event.queryStringParameters?.test === "true";
  const videoListResult = isTest ? await fetchTestVideoData(path) : await fetchHihahoVideoData(path);
  if (videoListResult) return videoListResult;


  // Statements Route
  if (path.endsWith("/statements")) {
    // Retreives statement if method is Get
    if (method === "GET") return await getStatements(event);

    // Creates statement if method is post
    if (method === "POST") {
      const body = JSON.parse(event.body);

      // Checks current session
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

      // Determines current LRS
      const lrsKey = isTest ? "scorm_test" : (body.lrs ?? "scorm");
      const lrs = getActiveLRS(lrsKey);

      // Retrieves video information for statement generation
      const { videoTitle, videoDescription, videoURL, objectId, objectDefinition } = isTest ? getTestVideoData(body) : await getHihahoVideoData(body.videoId);

      // Creates statement
      const statement = assembleStatement(body, videoTitle, videoDescription, videoURL, objectId, objectDefinition, lrs);

      // Sends statement to LRS
      return await sendStatement(statement, lrs);
    }
  }


  // Salesforce Routes
  if (path.endsWith("/salesforce/leads") && method === "GET") return await retrieveAllSalesforceLeads();
  if (path.endsWith("/salesforce/leads") && method === "POST") return await forwardLeadToSalesforce(event);

  return corsResponse(404, { error: "Unknown endpoint" });
};


// --------------------------------- Google Auth --------------------------------------------
// Exchanges Google auth code for tokens, verifies identity, creates session
async function handleGoogleAuth(event) {
  // Clean up expired sessions
  for (const [token, session] of Object.entries(activeSessions)) {
    if (Date.now() > session.expiresAt) delete activeSessions[token];
  }

  try {
    // Retrieve code and codeVerifier from body
    const { code, codeVerifier } = JSON.parse(event.body);
    if (!code || !codeVerifier) return corsResponse(400, { error: "Missing code or codeVerifier" });

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

    // Verifies the ID token with Google
    if (!tokenData.id_token) return corsResponse(401, { error: `Token exchange failed: ${JSON.stringify(tokenData)}` });
    const verifyRes  = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokenData.id_token}`);
    const googleData = await verifyRes.json();
    if (googleData.aud !== GOOGLE_CLIENT_ID) return corsResponse(401, { error: "Token audience mismatch" });
    if (!ALLOWED_EMAILS.includes(googleData.email)) return corsResponse(403, { error: "Email not authorised" });

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
async function handleValidateSession(event) {
  // No session token provided
  const sessionToken = event.headers?.["x-session-token"];
  if (!sessionToken) return corsResponse(400, { error: "No session token provided" });

  // Invalid, expired, or nonexistant session
  const session = activeSessions[sessionToken];
  if (!session)              return corsResponse(401, { valid: false, error: "Invalid session" });
  if (Date.now() > session.expiresAt) {
    delete activeSessions[sessionToken];
    return corsResponse(401, { valid: false, error: "Session expired" });
  }

  // Valid Session Token
  return corsResponse(200, {
    valid: true,
    email: session.email,
    name:  session.name
  });
}


// ------------------------------ CORS ---------------------------------------
// Retrieves path and method of a fetch request
function handleCORS(event) {
  const path   = event.requestContext?.http?.path   ?? "";
  const method = event.requestContext?.http?.method ?? "";

  // Special behavior for OPTIONS
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


// -------------------------------------- Hihaho API ------------------------------------------
// Fetches a list of videos from the Hihaho API
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

// Returns the test videos in the lambda
async function fetchTestVideoData(path){
  if (!path.endsWith("/videos")) return null;
  return corsResponse(200, testVideos);
}

// Gets the video data of a specific video based on the videoID provided in the event body
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
function getTestVideoData(body) {
  const video = testVideos.data.find(v => v.id === body.videoId);

  // No video found
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

  // For all other verbs: just use the video data
  return {
    videoTitle:       video.display_name,
    videoDescription: video.display_name,
    videoURL:         video.embed_url,
    objectId:         null,
    objectDefinition: null
  };
}


// ---------------------------------------------- Set LRS ------------------------------------------------------------
// Determine the current LRS based on the key provided
function getActiveLRS(lrsKey) {
  const key = lrsKey ?? "scorm";
  return LRS_CONFIGS[key] ?? LRS_CONFIGS.scorm;
}


// ----------------------------------------------------------- xAPI Statement --------------------------------------------------------------
// Constructs an xAPI statement based on the input parameters
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

// Sends a statement to the LRS
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


// ----------------------------------------------- Salesforce ------------------------------------------------
// Retrieves bearer token from Salesforce
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
  return data;
}

// Retrieves all leads from Salesforce
async function retrieveAllSalesforceLeads() {
  const token = await retrieveBearerToken();
  const res = await fetch(`https://${myDomainName}.my.salesforce.com/services/data/v63.0/query?q=SELECT+Id,Name,Email,Description+FROM+Lead`, {
    headers: { "Authorization": `Bearer ${token.access_token}` }
  });
  const data = await res.json();
  console.log("Data: ", data);
  return corsResponse(200, { records: data.records ?? [] });
}

// Creates a Lead for Salesforce to recieve
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

// Forwards lead to salesforce
async function forwardLeadToSalesforce(event) {
  // Retrieves all student data from body
  const body = JSON.parse(event.body);
  const students = body.atRiskData ?? [];

  // Retrieves data and emails from each student
  const existingRes = await retrieveAllSalesforceLeads();
  const existingData = JSON.parse(existingRes.body);
  const existingEmails = new Set(existingData.records.map(l => l.Email?.toLowerCase()));

  // Starts forwarding process
  const token = await retrieveBearerToken();
  let created = 0;
  let skipped = 0;
  for (const student of students) {
    // Checks if duplicates exist and ignores them
    if (existingEmails.has(student.actor)) {
      skipped++;
      continue;
    }

    // Sends generates and forwards lead to Salesforce
    const leadData = createLeadData(student);
    const sfRes = await fetch(`https://${myDomainName}.my.salesforce.com/services/data/v63.0/sobjects/Lead`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(leadData)
    });
    created++;

    // Error check
    const sfData = await sfRes.json();
    console.log("Salesforce POST response:", JSON.stringify(sfData));
  }

  return corsResponse(200, {message: `Done. ${created} leads created, ${skipped} duplicates skipped.` });
}


// -------------------------------------------------- LRS Retrieval ---------------------------------------------------
// Retrieves information from the LRS
async function getStatements(event) {
  // Determine current LRS and authorize access to it
  const lrsKey = event.queryStringParameters?.lrs ?? "scorm";
  const lrs = getActiveLRS(lrsKey);
  const auth = btoa(`${lrs.username}:${lrs.password}`);

  // Strip lrs param before forwarding to LRS
  const forwardParams = { ...event.queryStringParameters };
  console.log("Forward Params: ", forwardParams);
  const limit = Math.min(parseInt(forwardParams.limit ?? 100), 4000);
  const since = forwardParams.since ? new Date(forwardParams.since) : null;
  const until = forwardParams.until ? new Date(forwardParams.until) : null;
  delete forwardParams.lrs;
  delete forwardParams.test;
  delete forwardParams.limit;
  delete forwardParams.since;
  delete forwardParams.until;
  const baseParams = new URLSearchParams(forwardParams).toString();
  console.log("Base Params: ", baseParams);

  // Fetch all statements, following `more` links if needed
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

    // Appends retrieved statements to the allFetched array
    const data = await lrsResponse.json();
    const statements = data.statements ?? [];
    console.log("Statements: ", statements.length);

    // Filters statements to ensure it abides by since and until parameters
    const filtered = statements.filter(s => {
      const ts = new Date(s.timestamp);
      if (since && ts < since) return false;
      if (until && ts > until) return false;
      return true;
    });
    console.log("Filtered: ", filtered.length);
    allFetched = allFetched.concat(filtered);

    // Follow the `more` URL if we still need more results
    if (data.more && allFetched.length < limit) nextUrl = `${new URL(lrs.endpoint).origin}${data.more}`;
    else nextUrl = null;
  }

  const trimmed = allFetched.slice(0, limit);
  return corsResponse(200, { statements: trimmed });
}


// -------------------------------------- Test Video Information -----------------------------------
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