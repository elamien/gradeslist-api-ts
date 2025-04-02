import { DateTime } from 'luxon';
import { Assignment, CourseList, Course, IGSConnection } from './types';
import axios from 'axios';
import { JSDOM } from 'jsdom';
// import type { GSConnection } from './connection'; // No longer needed directly

// NOTE: This module relies heavily on parsing the Gradescope HTML structure.
// Any changes to the Gradescope website's UI (CSS selectors, layout) will
// likely break the data extraction logic below and require updates.
// Implement robust error handling and potentially monitoring in the calling application.

export class Account {
    private connection: IGSConnection;

    constructor(connection: IGSConnection) {
        this.connection = connection;
    }

    private parseDate(element: Element | null): DateTime | null {
        if (!element) {
            return null;
        }

        // Try parsing the datetime attribute using fromSQL (more flexible than fromISO)
        const datetimeAttr = element.getAttribute('datetime');
        if (datetimeAttr) {
            try {
                // Luxon's fromSQL expects space 'T' separator, replace space before timezone offset
                const isoString = datetimeAttr.replace(/ ([-+])/, 'T$1');
                const parsed = DateTime.fromISO(isoString);
                if (parsed.isValid) {
                    return parsed;
                }
            } catch (e) { /* Ignore parsing errors, try next method */ }
        }

        // Fallback to parsing the human-readable text
        let dateText = element.textContent?.trim();
        if (dateText) {
            try {
                // Handle optional "Late Due Date: " prefix
                if (dateText.startsWith('Late Due Date: ')) {
                    dateText = dateText.substring('Late Due Date: '.length);
                }

                // Handle formats like "Aug 27 at 2:00PM" or "Sep 06 at 11:59PM"
                // Use 'h' for 12-hour clock, 'hh' requires leading zero
                // Added ' ' to handle potential single/double space after 'at'
                const formatStrings = ["MMM dd 'at' h:mma", "MMM dd 'at'  h:mma"];
                for (const fmt of formatStrings) {
                    // Try parsing with explicit timezone (adjust if needed based on gon.timezone)
                    const parsed = DateTime.fromFormat(dateText, fmt, { zone: 'America/New_York' });
                    if (parsed.isValid) {
                        return parsed;
                    }
                }
            } catch (e) { /* Ignore parsing errors */ }
        }

        console.error(`Failed to parse date from element: ${element.outerHTML}`);
        return null;
    }

    private parseCourseInfo(courseBox: Element): Course | null {
        try {
            const shortNameElement = courseBox.querySelector('.courseBox--shortname');
            const nameElement = courseBox.querySelector('.courseBox--name');
            const term = courseBox.closest('.courseList--coursesForTerm')
                ?.previousElementSibling?.textContent?.trim() || '';

            const name = nameElement?.textContent?.trim() || shortNameElement?.textContent?.trim();
            const href = (courseBox as HTMLAnchorElement).href;
            const courseId = href?.split('/').pop();

            if (!name || !courseId) {
                console.error('Could not parse name or ID for course element:', courseBox.outerHTML);
                return null; // Indicate failure
            }

            return {
                id: courseId,
                name,
                term
            };
        } catch (error) {
            console.error('Error parsing course info for element:', courseBox.outerHTML, error);
            return null; // Indicate failure
        }
    }

    async get_courses(): Promise<CourseList> {
        const response = await axios.get('https://www.gradescope.com/account', {
            headers: {
                Cookie: this.connection.getCookies() 
            }
        });

        const dom = new JSDOM(response.data);
        const document = dom.window.document;

        const courses: CourseList = {
            student: {},
            instructor: {}
        };

        // Parse student courses
        const studentCourseElements = document.querySelectorAll('.courseList--coursesForTerm .courseBox:not(.courseBox-new)');
        studentCourseElements.forEach((courseElement) => {
            const course = this.parseCourseInfo(courseElement);
            if (course) { // Only add if parsing succeeded
                courses.student[course.id] = course;
            }
        });

        return courses;
    }


    async get_assignments(courseId: string): Promise<Assignment[]> {
        const response = await axios.get(`https://www.gradescope.com/courses/${courseId}`, {
            headers: {
                Cookie: this.connection.getCookies()
            }
        });

        const dom = new JSDOM(response.data);
        const document = dom.window.document;

        const assignments: Assignment[] = [];
        const rows = document.querySelectorAll('#assignments-student-table tbody tr');

        rows.forEach((row) => {
            try { // Wrap processing for entire row
                let nameElement: Element | null = row.querySelector('th.table--primaryLink a');
                let name: string | null | undefined = null;
                let assignment_id: string | null | undefined = null;

                if (nameElement) {
                    // Found an <a> tag
                    name = nameElement.textContent?.trim();
                    const href = (nameElement as HTMLAnchorElement).href;
                    assignment_id = href?.split('/').pop() || href?.split('/')[4]; 
                } else {
                    // Try finding a <button> tag instead
                    const buttonElement = row.querySelector('th.table--primaryLink button.js-submitAssignment');
                    if (buttonElement) {
                        name = buttonElement.textContent?.trim();
                        // Get ID from button's data attribute
                        assignment_id = (buttonElement as HTMLElement).dataset.assignmentId; 
                    }
                }

                // If neither <a> nor <button> with relevant info was found, check for plain text
                if (!nameElement && !assignment_id) {
                    const thElement = row.querySelector('th.table--primaryLink');
                    name = thElement?.textContent?.trim(); // Assign name if found

                    if (name) {
                        // We found the name, but have no way to get the real ID.
                        // Generate a placeholder ID using courseId and a slugified name.
                        const slugifiedName = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
                        assignment_id = `${courseId}-placeholder-${slugifiedName}`;
                        console.warn(`Warning: Generated placeholder ID "${assignment_id}" for assignment "${name}" (no link or button found).`);
                        // Proceed to parse the rest of the row with the placeholder ID
                    } else {
                         // Couldn't find anything identifiable in the first cell.
                         console.warn('Skipping row: Could not find assignment name (no link, button, or direct text). Returning null');
                         return; // Skip this row - cannot proceed without a name
                    }
                    // No longer return here - proceed with parsing below if name/placeholder ID were set
                }
                
                // Ensure name and id were successfully extracted or generated
                if (!name || !assignment_id) {
                    // This check should theoretically not be hit now if the logic above is correct
                    console.error('Critical Error: Failed to determine name or ID for row. Skipping.', /*row.outerHTML*/); // Removed HTML blob
                    return;
                }

                const statusElement = row.querySelector('td.submissionStatus');
                const releaseDateElement = row.querySelector('time.submissionTimeChart--releaseDate');
                // Select all due date elements within the row's date cell
                const dueDateElements = row.querySelectorAll('td:nth-of-type(2) time.submissionTimeChart--dueDate');

                const gradeText = statusElement?.querySelector('.submissionStatus--score')?.textContent?.trim() || '';
                const gradeMatch = gradeText.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
                const grade = gradeMatch ? parseFloat(gradeMatch[1]) : null;
                const max_grade = gradeMatch ? parseFloat(gradeMatch[2]) : null;

                // Extract submission status text more reliably
                let submissions_status = 'Not submitted'; // Default
                const statusTextElement = statusElement?.querySelector('.submissionStatus--text');
                if (statusTextElement) {
                    submissions_status = statusTextElement.textContent?.trim() || submissions_status;
                } else if (grade !== null) {
                    submissions_status = 'Graded'; // Assume graded if score exists and no specific text
                } else if (statusElement?.textContent?.includes('Submitted')) {
                     submissions_status = 'Submitted';
                } 
                // Note: Removed check for 'Ungraded' as status text usually covers this.

                // Add check for late status text
                if (statusElement?.textContent?.includes('Late')) {
                    submissions_status += ' (Late)';
                }

                const releaseDate = this.parseDate(releaseDateElement);
                // Parse the first element as the due date
                const dueDate = dueDateElements.length > 0 ? this.parseDate(dueDateElements[0]) : null;
                // Parse the second element (if it exists) as the late due date
                const lateDueDate = dueDateElements.length > 1 ? this.parseDate(dueDateElements[1]) : null;

                const assignment: Assignment = {
                    assignment_id,
                    name,
                    release_date: releaseDate,
                    due_date: dueDate,
                    late_due_date: lateDueDate,
                    submissions_status,
                    grade,
                    max_grade
                };

                assignments.push(assignment);
            } catch (error) {
                 console.error('Error processing assignment row:', row.outerHTML, error);
                 // Continue to next row instead of failing entirely
            }
        });

        return assignments;
    }
} 