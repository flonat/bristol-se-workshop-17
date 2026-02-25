// Generates the GitHub OAuth authorisation URL.
// GitHub uses the same Authorization Code Grant flow as Google,
// but with different endpoints and scope format.
async function getGitHubOAuthURL() {
    const rootURL = 'https://github.com/login/oauth/authorize';
    const options = {
        client_id: process.env.GITHUB_CLIENT_ID,
        redirect_uri: process.env.GITHUB_REDIRECT_URI,
        scope: 'read:user user:email',
        allow_signup: 'true'
    };
    const qs = new URLSearchParams(options);
    return `${rootURL}?${qs.toString()}`;
}

exports.getGitHubOAuthURL = getGitHubOAuthURL;
