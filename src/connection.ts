import axios, { AxiosInstance } from 'axios';
import { Account } from './account';
import { IGSConnection } from './types';

const DEFAULT_GRADESCOPE_BASE_URL = 'https://www.gradescope.com';

export class GSConnection implements IGSConnection {
  private session: AxiosInstance;
  private gradescope_base_url: string;
  private logged_in: boolean;
  private cookies: string;
  public account: Account | null;

  constructor(gradescope_base_url: string = DEFAULT_GRADESCOPE_BASE_URL) {
    this.gradescope_base_url = gradescope_base_url;
    this.logged_in = false;
    this.cookies = '';
    this.account = null;

    this.session = axios.create({
      baseURL: this.gradescope_base_url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Add response interceptor to capture cookies
    this.session.interceptors.response.use(response => {
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        // Parse existing cookies into a map
        const cookieMap = new Map();
        if (this.cookies) {
          this.cookies.split('; ').forEach(cookie => {
            const [name] = cookie.split('=');
            cookieMap.set(name, cookie);
          });
        }

        // Add new cookies to the map
        cookies.forEach(cookie => {
          const [cookieStr] = cookie.split(';');
          const [name] = cookieStr.split('=');
          cookieMap.set(name, cookieStr);
        });

        // Convert map back to cookie string
        this.cookies = Array.from(cookieMap.values()).join('; ');

        // NOTE: This cookie parsing assumes simple key=value cookies.
        // For more complex scenarios (e.g., unusual attributes), consider a dedicated library.

        // Update session headers with new cookies
        this.session.defaults.headers.Cookie = this.cookies;
      }
      return response;
    });
  }

  getCookies(): string {
    return this.cookies;
  }

  private async getAuthToken(): Promise<string> {
    const response = await this.session.get('/login');
    const html = response.data;
    const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    if (!match) {
      throw new Error('Could not find CSRF token');
    }
    return match[1];
  }

  async login(email: string, password: string): Promise<boolean> {
    // NOTE: This login process mimics a browser. Gradescope could implement rate limiting
    // or change login mechanisms, which would require updates here.
    // The calling application should handle potential login failures and consider
    // delays/queueing if calling this frequently for many users concurrently.
    console.log('Starting login process...');
    const auth_token = await this.getAuthToken();
    console.log('Got auth token.');

    const formData = new URLSearchParams();
    formData.append('utf8', '✓');
    formData.append('authenticity_token', auth_token);
    formData.append('session[email]', email);
    formData.append('session[password]', password);
    formData.append('session[remember_me]', '0');
    formData.append('commit', 'Log In');
    formData.append('session[remember_me_sso]', '0');

    const response = await this.session.post(`${this.gradescope_base_url}/login`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Origin': this.gradescope_base_url,
        'Referer': `${this.gradescope_base_url}/login`
      },
      maxRedirects: 0,
      validateStatus: (status) => status === 302
    });

    console.log('Login response status:', response.status);
    console.log('Login successful, following redirect...');

    if (response.status === 302) {
      const redirectUrl = response.headers.location;
      const fullRedirectUrl = redirectUrl.startsWith('http') ? redirectUrl : `${this.gradescope_base_url}${redirectUrl}`;
      const accountResponse = await this.session.get(fullRedirectUrl);
      
      if (accountResponse.status === 200) {
        // Check if we're still on the login page
        if (accountResponse.data.includes('Log in with your Gradescope account')) {
          return false;
        }
        // Initialize account after successful login
        this.account = new Account(this);
        return true;
      }
    }

    return false;
  }
} 