const baseUrl = (process.env.API_BASE_URL ?? process.argv[2] ?? "").replace(/\/+$/, "");
const expectedEnvironment = process.env.EXPECTED_APP_ENV;

const fail = (message) => {
  console.error(`deploy smoke failed: ${message}`);
  process.exit(1);
};

if (!baseUrl) {
  fail("set API_BASE_URL or pass the API URL as the first argument");
}

if (!/^https:\/\//.test(baseUrl) && process.env.ALLOW_INSECURE_DEPLOY_SMOKE !== "true") {
  fail("API_BASE_URL must be HTTPS unless ALLOW_INSECURE_DEPLOY_SMOKE=true");
}

const readJson = async (path, expectedStatus) => {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "fbmaniaco-deploy-smoke/1.0"
    }
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    fail(`${path} returned non-JSON response`);
  }
  if (response.status !== expectedStatus) {
    fail(`${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`);
  }
  return body;
};

const health = await readJson("/health", 200);
if (health.ok !== true || health.service !== "api") {
  fail(`/health returned an unexpected payload: ${JSON.stringify(health)}`);
}

if (expectedEnvironment && health.environment !== expectedEnvironment) {
  fail(`/health environment is ${health.environment}, expected ${expectedEnvironment}`);
}

const ready = await readJson("/ready", 200);
if (ready.ok !== true) {
  fail(`/ready is not ok: ${JSON.stringify(ready)}`);
}

for (const check of ["config", "db", "queue", "worker"]) {
  if (ready.checks?.[check] !== true) {
    fail(`/ready check ${check} is not true: ${JSON.stringify(ready.checks)}`);
  }
}

console.log(`deploy smoke ok (${health.environment ?? "unknown"} ${health.release ?? "unknown-release"})`);
