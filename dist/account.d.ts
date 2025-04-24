import { Assignment, CourseList, IGSConnection } from './types';
export declare class Account {
    private connection;
    constructor(connection: IGSConnection);
    private parseDate;
    private parseCourseInfo;
    get_courses(): Promise<CourseList>;
    get_assignments(courseId: string): Promise<Assignment[]>;
}
//# sourceMappingURL=account.d.ts.map