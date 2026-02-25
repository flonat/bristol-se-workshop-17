require("dotenv").config()

const express = require('express')
const path = require('path')
const ip = require('ip');
const https = require("https");
var fs = require('fs');
const WebSocket = require('ws');
const cors = require('cors');

const cookieParser = require('cookie-parser');

const oauthurl = require('./helper-oauth-pkce-url');
const oauthHandler = require('./helper-oauth-pkce-handler');
const refreshHelper = require('./helper-refresh-token');

const clients = new Map()
const sessions = new Map()

run()
initWS()

function run() {
    const app = express()

    app.use(cookieParser());
    app.use(express.json())
    app.use(express.static('public'))

    app.use(cors({
        origin: [`https://${ip.address()}:${process.env.PORT_OAUTH}/`,
        `wss://${ip.address()}:${process.env.PORT_WS}/`],
        credentials: true
    }));

    // Read SSL certificate and key files
    const options = {
        key: fs.readFileSync(path.join(__dirname, "private.key")),
        cert: fs.readFileSync(path.join(__dirname, "server.crt")),
    };

    // Create HTTPS server
    const server = https.createServer(options, app);
    server.listen(process.env.PORT_OAUTH, () => {
        console.log(`oserver running @ https://${ip.address()}:${process.env.PORT_OAUTH}/`)
    });

    // Modified authenticateToken middleware with refresh token support.
    // If the access token cookie has expired but a refresh token cookie exists,
    // use the refresh token to silently obtain a new access token and set
    // updated cookies, avoiding a full re-authentication redirect.
    const authenticateTokenPkce = async (req, res, next) => {
        const accessToken = req.cookies.accessToken;

        if (accessToken) {
            // Access token still valid — proceed to the route handler
            return next();
        }

        // No access token — check for a refresh token before redirecting to Google
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
            try {
                const newTokens = await refreshHelper.refreshAccessToken(refreshToken);
                if (newTokens && newTokens.access_token) {
                    // Set the new access token cookie
                    res.cookie("accessToken", newTokens.access_token, {
                        httpOnly: true,
                        secure: true,
                        sameSite: 'strict',
                        maxAge: (newTokens.expires_in || 3599) * 1000
                    });
                    console.log('Access token refreshed successfully');
                    return next();
                }
            } catch (error) {
                console.error('Refresh token failed:', error.message);
            }
        }

        // No valid tokens — redirect to Google OAuth
        const sid = req.cookies['msession-id'];
        oauthurl.getGoogleOAuthURLpkce().then(([googleAuthUrl, code_verifier]) => {
            sessions.set(sid, { 'code_verifier': code_verifier, 'googleAuthUrl': googleAuthUrl })
            const redirectUrl = `${googleAuthUrl}&state=${sid}`;
            return res.send(redirectUrl);
        }).catch((error) => {
            console.error("Error generating Google OAuth URL:", error);
        });
    };


    app.get("/auth", authenticateTokenPkce, (request, response) => {
        response.sendFile(path.join(__dirname, '/eindex-oauth.html'))
    })
    app.get("/", (request, response) => {
        response.sendFile(path.join(__dirname, '/login.html'))
    })

    app.get("/session", (request, response) => {
        const sid = uuidv4()
        response.setHeader('Set-Cookie', [`msession-id=${sid}; Secure;`])
        return response.status(200).send(`session created with id: ${sid}`);
    })

    // Explicit refresh endpoint: the client can call this to proactively
    // refresh the access token before it expires.
    app.get("/auth/refresh", async (req, res) => {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            return res.status(401).send("No refresh token available. Please log in again.");
        }

        const newTokens = await refreshHelper.refreshAccessToken(refreshToken);
        if (!newTokens || !newTokens.access_token) {
            return res.status(401).send("Failed to refresh token. Please log in again.");
        }

        res.cookie("accessToken", newTokens.access_token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: (newTokens.expires_in || 3599) * 1000
        });

        return res.status(200).send("Token refreshed successfully.");
    });

    app.get("/auth/google/callback", async (req, res) => {
        try {
            //validate session state parameter
            const sessionID = req.query.state;
            if (!sessions.has(sessionID)) {
                return res.status(400).send("Invalid session ID");
            }

            //get tokens and user info
            let { googleUser, tokens } = await oauthHandler.googleOauthHandler(req, res, sessions)

            //set cookies
            const id = uuidv4()
            res.setHeader('Set-Cookie', [`ws_host=localhost:${process.env.PORT_WS}`, `sessionID=${id}`])

            res.cookie("accessToken", tokens.access_token, {
                httpOnly: true,
                secure: true,
                expires: new Date(tokens.expiry_date),
                sameSite: 'strict',
                maxAge: 900000 //15 mins
            });
            res.cookie("refreshToken", tokens.refresh_token, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                maxAge: 3.15e10 //1 year
            });
            res.cookie("email", googleUser.email, {
                httpOnly: false,
                secure: true,
                expires: new Date(tokens.expiry_date),
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("name", googleUser.name, {
                httpOnly: false,
                secure: true,
                expires: new Date(tokens.expiry_date),
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("family_name", googleUser.family_name, {
                httpOnly: false,
                secure: true,
                expires: new Date(tokens.expiry_date),
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("given_name", googleUser.given_name, {
                httpOnly: false,
                secure: true,
                expires: new Date(tokens.expiry_date),
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("picture", googleUser.picture, {
                httpOnly: false,
                secure: true,
                expires: new Date(tokens.expiry_date),
                sameSite: 'strict',
                maxAge: 900000
            });

            res.sendFile(path.join(__dirname, '/eindex-oauth.html'))
        }
        catch (error) {
            if (error.message.includes('invalid_grant')) {
                return res.redirect(path.join(__dirname, '/login.html'))
            } else {
                return res.status(500).send("Authentication failed.");
            }
        }
    });
}


async function initWS() {
    return new Promise(async (resolve) => {
        const ssloptions = {
            key: fs.readFileSync(path.join(__dirname, "private.key")),
            cert: fs.readFileSync(path.join(__dirname, "server.crt")),
        };

        const httpsServer = https.createServer(ssloptions);
        const wss = new WebSocket.Server({ server: httpsServer });

        wss.on('connection', (ws, req) => {
            const id = getCookie(req, 'sessionID')
            const color = Math.floor(Math.random() * 360)
            const date_time = new Date();
            let month = ("0" + (date_time.getMonth() + 1)).slice(-2);
            let date = ("0" + date_time.getDate()).slice(-2);
            let year = date_time.getFullYear();
            let hours = date_time.getHours();
            let minutes = date_time.getMinutes();
            let seconds = date_time.getSeconds();
            let time = `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`

            const metadata = { 'id': id, 'color': color, 'date': time };

            let parameters = req.url.split('/forum?')[1].split("&")
            for (let i = 0; i < parameters.length; i++) {
                let parameter = parameters[i].split('=')
                let key = parameter[0]
                let value = parameter[1]
                if (key === 'name') {
                    metadata.name = value
                }
                if (key === 'email') {
                    metadata.email = value
                }
            }

            clients.set(ws, metadata)

            let payload = JSON.parse(JSON.stringify(metadata))
            payload.message = `joined forum`
            broadcastMessage(payload)

            ws.on('message', (data, isBinary) => {
                const metadata = clients.get(ws)
                const message = isBinary ? data : data.toString();
                let payload = JSON.parse(JSON.stringify(metadata))
                payload.message = message
                broadcastMessage(payload)
            })

            ws.on('close', function () {
                const metadata = clients.get(ws)
                clients.delete(ws);
                let payload = JSON.parse(JSON.stringify(metadata))
                payload.message = `left forum`
                broadcastMessage(payload)
            });
        })

        httpsServer.listen(process.env.PORT_WS, () => {
            console.log(`Secure SSE-Forum WebSocket endpoint running @ wss://${ip.address()}:${process.env.PORT_WS}`);
            resolve(true);
        });

        resolve(true)
    })
}

function broadcastMessage(payload) {
    const date_time = new Date();
    let month = ("0" + (date_time.getMonth() + 1)).slice(-2);
    let year = date_time.getFullYear();
    let date = ("0" + date_time.getDate()).slice(-2);
    let hours = date_time.getHours();
    let minutes = date_time.getMinutes();
    let seconds = date_time.getSeconds();
    let time = `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`

    payload.time = time
    payload.activeparticipants = clients.size
    const outbound = JSON.stringify(payload);

    setTimeout(function () {
        [...clients.keys()].forEach((client) => {
            client.send(outbound);
        });
    }, 500);
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getCookie(request, cookiename) {
    const cookieHeader = request.headers?.cookie;
    let a = `; ${cookieHeader}`.match(`;\\s*${cookiename}=([^;]+)`);
    return a ? a[1] : '';
}
