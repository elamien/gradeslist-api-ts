// Main library entry point

// Export core classes
export { GSConnection } from './connection';
export { Account } from './account';

// Export relevant types for consumers
export {
    Assignment,
    Course,
    CourseList,
    Member,
    IGSConnection // Exporting the interface might be useful for mocking or dependency injection
} from './types'; 