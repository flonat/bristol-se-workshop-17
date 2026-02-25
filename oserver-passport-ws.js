require("dotenv").config()

const express = require('express')
const path = require('path')
const ip = require('ip');
const https = require("https");
var fs = require('fs');
const WebSocket = require('ws');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const clients = new Map()

// Configure Passport with Google OAuth 2.0 Strategy.
// Passport abstracts the OAuth flow: it handles the redirect to Google,
// the callback, and token exchange internally.
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_REDIRECT_URI
}, (accessToken, refreshToken, profile, done) => {
    // The verify callback receives the tokens and profile from Google.
    // We attach the tokens to the profile object for cookie setting later.
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    return done(null, profile);
}));

// Serialise/deserialise user for session management
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

run()
initWS()

function run() {
    const app = express()

    app.use(cookieParser());
    app.use(express.json())
    app.use(express.static('public'))

    // Express session is required for Passport
    app.use(session({
        secret: 'sse-forum-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: true }
    }));

    app.use(passport.initialize());
    app.use(passport.session());

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

    app.get("/", (request, response) => {
        response.sendFile(path.join(__dirname, '/login.html'))
    })

    // Passport handles the redirect to Google's consent screen.
    // The scope specifies what user data we want access to.
    app.get("/auth",
        passport.authenticate('google', {
            scope: ['profile', 'email'],
            accessType: 'offline',
            prompt: 'consent'
        })
    );

    // Passport handles the callback: it exchanges the code for tokens,
    // fetches the user profile, and invokes the verify callback above.
    app.get("/auth/google/callback",
        passport.authenticate('google', { failureRedirect: '/' }),
        (req, res) => {
            const user = req.user;

            // Set cookies with user info (same pattern as the manual implementation)
            res.setHeader('Set-Cookie', [`ws_host=localhost:${process.env.PORT_WS}`, `sessionID=${uuidv4()}`])

            res.cookie("accessToken", user.accessToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                maxAge: 900000
            });
            if (user.refreshToken) {
                res.cookie("refreshToken", user.refreshToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: 'strict',
                    maxAge: 3.15e10
                });
            }

            const email = user.emails && user.emails[0] ? user.emails[0].value : '';
            const name = user.displayName || '';
            const familyName = user.name ? user.name.familyName : '';
            const givenName = user.name ? user.name.givenName : '';
            const picture = user.photos && user.photos[0] ? user.photos[0].value : '';

            res.cookie("email", email, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 900000 });
            res.cookie("name", name, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 900000 });
            res.cookie("family_name", familyName, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 900000 });
            res.cookie("given_name", givenName, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 900000 });
            res.cookie("picture", picture, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 900000 });

            res.sendFile(path.join(__dirname, '/eindex-oauth.html'))
        }
    );
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
