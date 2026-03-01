/**
 * Authentication module
 */

export class Auth {
  constructor(env) {
    this.env = env;
  }

  authenticate(request) {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return { success: false };
    }

    try {
      const base64Credentials = authHeader.slice(6);
      const credentials = atob(base64Credentials);
      const [username, password] = credentials.split(':');

      const validUsername = this.env.USERNAME || 'admin';
      const validPassword = this.env.PASSWORD || 'changeme';

      if (username === validUsername && password === validPassword) {
        return { success: true, username };
      }

      return { success: false };
    } catch (error) {
      console.error('Auth error:', error);
      return { success: false };
    }
  }
}
