require("dotenv").config()

const express = require('express')
const path = require('path')
const ip = require('ip');
const https = require("https");
var fs = require('fs');
const WebSocket = require('ws');
const cors = require('cors');

const cookieParser = require('cookie-parser');

const githubOauthUrl = require('./helper-github-oauth-url');
const githubOauthHandler = require('./helper-github-oauth-handler');

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

    const options = {
        key: fs.readFileSync(path.join(__dirname, "private.key")),
        cert: fs.readFileSync(path.join(__dirname, "server.crt")),
    };

    const server = https.createServer(options, app);
    server.listen(process.env.PORT_OAUTH, () => {
        console.log(`oserver running @ https://${ip.address()}:${process.env.PORT_OAUTH}/`)
    });

    // Authentication middleware — redirects to GitHub if no access token
    const authenticateToken = async (req, res, next) => {
        const accessToken = req.cookies.accessToken;
        if (accessToken) {
            return next();
        }

        const sid = req.cookies['msession-id'];
        githubOauthUrl.getGitHubOAuthURL().then((githubAuthUrl) => {
            sessions.set(sid, { 'githubAuthUrl': githubAuthUrl });
            const redirectUrl = `${githubAuthUrl}&state=${sid}`;
            return res.send(redirectUrl);
        }).catch((error) => {
            console.error("Error generating GitHub OAuth URL:", error);
            return res.status(500).send("Error generating OAuth URL");
        });
    };

    app.get("/auth", authenticateToken, (request, response) => {
        response.sendFile(path.join(__dirname, '/eindex-oauth.html'))
    })
    app.get("/", (request, response) => {
        response.sendFile(path.join(__dirname, '/login-github.html'))
    })

    app.get("/session", (request, response) => {
        const sid = uuidv4()
        response.setHeader('Set-Cookie', [`msession-id=${sid}; Secure;`])
        return response.status(200).send(`session created with id: ${sid}`);
    })

    // GitHub callback endpoint — analogous to /auth/google/callback
    app.get("/auth/github/callback", async (req, res) => {
        try {
            const sessionID = req.query.state;
            if (!sessions.has(sessionID)) {
                return res.status(400).send("Invalid session ID");
            }

            let { githubUser, tokens } = await githubOauthHandler.githubOauthHandler(req, res);

            const id = uuidv4()
            res.setHeader('Set-Cookie', [`ws_host=localhost:${process.env.PORT_WS}`, `sessionID=${id}`])

            res.cookie("accessToken", tokens.access_token, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("email", githubUser.email || '', {
                httpOnly: false,
                secure: true,
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("name", githubUser.name || githubUser.login, {
                httpOnly: false,
                secure: true,
                sameSite: 'strict',
                maxAge: 900000
            });
            res.cookie("picture", githubUser.avatar_url || '', {
                httpOnly: false,
                secure: true,
                sameSite: 'strict',
                maxAge: 900000
            });

            res.sendFile(path.join(__dirname, '/eindex-oauth.html'))
        }
        catch (error) {
            console.error('GitHub callback error:', error);
            return res.status(500).send("Authentication failed.");
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
                if (key === 'name') { metadata.name = value }
                if (key === 'email') { metadata.email = value }
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
