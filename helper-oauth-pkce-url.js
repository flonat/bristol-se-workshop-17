
const pkceChallenge = require('./helper-pkce');

async function getGoogleOAuthURLpkce() {
    const code_verifier = pkceChallenge.generateCodeVerifier();//generate code verifier
    const code_challenge = await pkceChallenge.getCodeChallenge(code_verifier);//generate code challenge
    const code_challenge_method = pkceChallenge.getCodeChallengeMethod();

    const rootURL = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        client_id: process.env.GOOGLE_CLIENT_ID,
        access_type: 'offline',
        response_type: 'code',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
        ].join(' '),
        code_challenge_method: code_challenge_method,
        code_challenge: code_challenge,
    }
    const qs = new URLSearchParams(options)

    return [`${rootURL}?${qs.toString()}`, code_verifier]
}
exports.getGoogleOAuthURLpkce = getGoogleOAuthURLpkce;