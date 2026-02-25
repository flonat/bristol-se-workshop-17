const crypto = require('crypto');

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('hex');
}

async function getCodeChallenge(codeVerifier) {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return hash;
}

function getCodeChallengeMethod() {
    return 'S256';
}

module.exports = {
    generateCodeVerifier,
    getCodeChallenge,
    getCodeChallengeMethod
};