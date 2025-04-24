import { Account } from './account';
import { IGSConnection } from './types';
export declare class GSConnection implements IGSConnection {
    private session;
    private gradescope_base_url;
    private logged_in;
    private cookies;
    account: Account | null;
    constructor(gradescope_base_url?: string);
    getCookies(): string;
    private getAuthToken;
    login(email: string, password: string): Promise<boolean>;
}
//# sourceMappingURL=connection.d.ts.map