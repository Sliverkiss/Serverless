const { APNS, Notification, Errors } = require("apns2");
const Koa = require("koa");
const Router = require("@koa/router");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("koa-bodyparser");
const meta = require("./package.json");

/**
 * Cert info from: https://github.com/Finb/bark-server/blob/master/deploy/AuthKey_LH4T9V5U4R_5U8LBRXG3A.p8
 */
const APN_KEY = "LH4T9V5U4R";
const TEAM_ID = "5U8LBRXG3A";
const CERT = `
-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg4vtC3g5L5HgKGJ2+
T1eA0tOivREvEAY2g+juRXJkYL2gCgYIKoZIzj0DAQehRANCAASmOs3JkSyoGEWZ
sUGxFs/4pw1rIlSV2IC19M8u3G5kq36upOwyFWj9Gi3Ejc9d3sC7+SHRqXrEAJow
8/7tRpV+
-----END PRIVATE KEY-----
`;

const app = new Koa();
const router = new Router();
const db = new sqlite3.Database("devices.db");
const client = new APNS({
    team: TEAM_ID,
    keyId: APN_KEY,
    signingKey: CERT,
    defaultTopic: "me.fin.bark"
});

async function ensureInitDb() {
    db.run("CREATE TABLE IF NOT EXISTS token (key TEXT NOT NULL PRIMARY KEY, token TEXT)");
}

async function putDeviceToken(key, deviceToken) {
    db.run("REPLACE INTO token (key, token) VALUES(?, ?)", key, deviceToken);
}

async function getDeviceToken(key) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM token WHERE key = ?", key, (err, row) => {
            if (err) {
                reject(err);
            } else if (row && row.token) {
                resolve(row.token);
            } else {
                resolve(null);
            }
        });
    });
}

async function ping(ctx) {
    ctx.body = {
        "code": 200,
        "data": {
            "version": meta.version
        },
        "message": "pong"
    };
}

async function register(ctx) {
    let { key, deviceToken } = ctx.query;
    if (key && deviceToken) {
        await putDeviceToken(key, deviceToken);
        ctx.body = {
            "code": 200,
            "data": {
                key, deviceToken
            },
            "message": "Registration successful"
        };
    } else {
        ctx.body = { "code": 400, "message": "Wrong query params" };
    }
}

/**
 * Support both query strings or request body
 */
function getParamCompat(ctx, paramName, fallback) {
    if (ctx.query[paramName]) {
        return ctx.query[paramName];
    }
    if (ctx.request.body && ctx.request.body[paramName]) {
        return ctx.request.body[paramName];
    }
    return fallback;
}

async function send(ctx) {
    let { key, title, body } = ctx.params;
    if (!key) {
        ctx.body = { "code": 400, "message": "Wrong path params" };
        return;
    }
    let deviceToken = await getDeviceToken(key);
    if (!deviceToken) {
        ctx.body = { "code": 400, "message": `DeviceToken not found by the given key ${key}` };
        return;
    }
    if (!title) {
        title = getParamCompat(ctx, "title");
    }
    if (!body) {
        body = getParamCompat(ctx, "body");
    }
    let url = getParamCompat(ctx, "url");
    let copy = getParamCompat(ctx, "copy");
    let sound = getParamCompat(ctx, "sound", "1107");
    let isArchive = getParamCompat(ctx, "isArchive");
    let automaticallyCopy = getParamCompat(ctx, "automaticallyCopy");
    let category = "myNotificationCategory";
    let payload = {
        aps: {
            sound,
            category,
            "mutable-content": 1,
            alert: {
                title, body
            },
        },
        data: {
            isArchive, url, copy, automaticallyCopy
        },
    };
    let response = await client.send(new Notification(deviceToken, payload));
    console.log(response);
    ctx.body = { "code": 200, "message": response };
}

router.get("/ping", ping);
router.get("/register", register);
router.get("/:key/:body", send);
router.get("/:key/:title/:body", send);
router.post("/:key/:body", send);
router.post("/:key/:title/:body", send);

client.on(Errors.error, (err) => {
    console.error(JSON.stringify(err));
});

ensureInitDb();

app.use(bodyParser());
app.use(router.routes());
app.listen(80);
