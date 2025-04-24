"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Account = void 0;
const luxon_1 = require("luxon");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio")); // Use cheerio instead of JSDOM
// import type { CheerioAPI, Element } from 'cheerio'; // Remove explicit type imports
// import type { GSConnection } from './connection'; // No longer needed directly
// NOTE: This module relies heavily on parsing the Gradescope HTML structure.
// Any changes to the Gradescope website's UI (CSS selectors, layout) will
// likely break the data extraction logic below and require updates.
// Implement robust error handling and potentially monitoring in the calling application.
class Account {
    constructor(connection) {
        this.connection = connection;
    }
    // Updated parseDate to accept Cheerio elements
    parseDate($, element) {
        if (!element) {
            return null;
        }
        const $element = $(element); // Wrap element with Cheerio
        // Try parsing the datetime attribute
        const datetimeAttr = $element.attr('datetime');
        if (datetimeAttr) {
            try {
                const isoString = datetimeAttr.replace(/ ([-+])/, 'T$1');
                const parsed = luxon_1.DateTime.fromISO(isoString);
                if (parsed.isValid) {
                    return parsed;
                }
            }
            catch (e) { /* Ignore parsing errors, try next method */ }
        }
        // Fallback to parsing the human-readable text
        let dateText = $element.text()?.trim();
        if (dateText) {
            try {
                if (dateText.startsWith('Late Due Date: ')) {
                    dateText = dateText.substring('Late Due Date: '.length);
                }
                const formatStrings = ["MMM dd 'at' h:mma", "MMM dd 'at'  h:mma"];
                for (const fmt of formatStrings) {
                    const parsed = luxon_1.DateTime.fromFormat(dateText, fmt, { zone: 'America/New_York' });
                    if (parsed.isValid) {
                        return parsed;
                    }
                }
            }
            catch (e) { /* Ignore parsing errors */ }
        }
        console.error(`Failed to parse date from element: ${$.html(element)}`);
        return null;
    }
    // Updated parseCourseInfo to accept Cheerio elements
    parseCourseInfo($, courseBox) {
        try {
            const $courseBox = $(courseBox); // Wrap element with Cheerio
            const shortNameElement = $courseBox.find('.courseBox--shortname');
            const nameElement = $courseBox.find('.courseBox--name');
            const term = $courseBox.closest('.courseList--coursesForTerm')
                .prev() // Use .prev() for previous sibling in Cheerio
                .text()?.trim() || '';
            const name = nameElement.text()?.trim() || shortNameElement.text()?.trim();
            const href = $courseBox.attr('href'); // Get href attribute
            const courseId = href?.split('/').pop();
            if (!name || !courseId) {
                console.error('Could not parse name or ID for course element:', $.html(courseBox));
                return null;
            }
            return {
                id: courseId,
                name,
                term
            };
        }
        catch (error) {
            console.error('Error parsing course info for element:', $.html(courseBox), error);
            return null;
        }
    }
    async get_courses() {
        const response = await axios_1.default.get('https://www.gradescope.com/account', {
            headers: {
                Cookie: this.connection.getCookies()
            }
        });
        const $ = cheerio.load(response.data); // Load HTML into Cheerio
        const courses = {
            student: {},
            instructor: {}
        };
        // Parse student courses using Cheerio selectors and iteration
        $('.courseList--coursesForTerm .courseBox:not(.courseBox-new)').each((index, element) => {
            const course = this.parseCourseInfo($, element);
            if (course) {
                courses.student[course.id] = course;
            }
        });
        // TODO: Add instructor course parsing if needed (selector might differ)
        return courses;
    }
    async get_assignments(courseId) {
        const response = await axios_1.default.get(`https://www.gradescope.com/courses/${courseId}`, {
            headers: {
                Cookie: this.connection.getCookies()
            }
        });
        const $ = cheerio.load(response.data); // Load HTML into Cheerio
        const assignments = [];
        // Use Cheerio selector and iteration
        $('#assignments-student-table tbody tr').each((index, rowElement) => {
            try {
                const $row = $(rowElement); // Wrap row element
                const $nameCell = $row.find('th.table--primaryLink');
                const $anchor = $nameCell.find('a');
                const $button = $nameCell.find('button.js-submitAssignment');
                let name = undefined;
                let assignment_id = undefined;
                if ($anchor.length > 0) {
                    name = $anchor.text()?.trim();
                    const href = $anchor.attr('href');
                    assignment_id = href?.split('/').pop() || href?.split('/')[4];
                }
                else if ($button.length > 0) {
                    name = $button.text()?.trim();
                    assignment_id = $button.data('assignment-id'); // Use .data() for data attributes
                }
                if (!assignment_id) { // Check if ID wasn't found via link or button
                    name = $nameCell.text()?.trim();
                    if (name) {
                        const slugifiedName = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
                        assignment_id = `${courseId}-placeholder-${slugifiedName}`;
                        console.warn(`Warning: Generated placeholder ID "${assignment_id}" for assignment "${name}" (no link or button found).`);
                    }
                    else {
                        console.warn('Skipping row: Could not find assignment name.', $.html($row));
                        return; // Use Cheerio's return to continue .each loop
                    }
                }
                if (!name || !assignment_id) {
                    console.error('Critical Error: Failed to determine name or ID for row. Skipping.', $.html($row));
                    return; // Continue .each loop
                }
                const $statusCell = $row.find('td.submissionStatus');
                const $dateCell = $row.find('td:nth-of-type(2)');
                const releaseDateElement = $dateCell.find('time.submissionTimeChart--releaseDate').get(0); // Get underlying Element
                const dueDateElements = $dateCell.find('time.submissionTimeChart--dueDate').get(); // Get array of Elements
                const gradeText = $statusCell.find('.submissionStatus--score').text()?.trim() || '';
                const gradeMatch = gradeText.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
                const grade = gradeMatch ? parseFloat(gradeMatch[1]) : null;
                const max_grade = gradeMatch ? parseFloat(gradeMatch[2]) : null;
                let submissions_status = 'Not submitted';
                const statusText = $statusCell.find('.submissionStatus--text').text()?.trim();
                if (statusText) {
                    submissions_status = statusText;
                }
                else if (grade !== null) {
                    submissions_status = 'Graded';
                }
                else if ($statusCell.text()?.includes('Submitted')) {
                    submissions_status = 'Submitted';
                }
                if ($statusCell.text()?.includes('Late')) {
                    submissions_status += ' (Late)';
                }
                const releaseDate = this.parseDate($, releaseDateElement);
                const dueDate = dueDateElements.length > 0 ? this.parseDate($, dueDateElements[0]) : null;
                const lateDueDate = dueDateElements.length > 1 ? this.parseDate($, dueDateElements[1]) : null;
                const assignment = {
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
            }
            catch (error) {
                console.error('Error processing assignment row:', $.html(rowElement), error);
                // Continue to next row
            }
        });
        return assignments;
    }
}
exports.Account = Account;
//# sourceMappingURL=account.js.map