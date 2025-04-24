import { DateTime } from 'luxon';
export interface Assignment {
    assignment_id: string;
    name: string;
    release_date: DateTime | null;
    due_date: DateTime | null;
    late_due_date: DateTime | null;
    submissions_status: string;
    grade: number | null;
    max_grade: number | null;
}
export interface Course {
    id: string;
    name: string;
    term: string;
}
export interface Member {
    name: string;
    email: string;
    role: string;
    sid?: string;
}
export interface CourseList {
    instructor: {
        [key: string]: Course;
    };
    student: {
        [key: string]: Course;
    };
}
export interface IGSConnection {
    getCookies(): string;
}
//# sourceMappingURL=types.d.ts.map