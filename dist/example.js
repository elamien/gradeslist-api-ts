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
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const readline = __importStar(require("readline")); // Import readline
const connection_1 = require("./connection");
const perf_hooks_1 = require("perf_hooks"); // Import performance
// Function to ask user for term
function askForTerm(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim()); // Trim whitespace from the answer
    }));
}
// Load environment variables
dotenv.config();
async function main() {
    // Ask the user for the target term first
    const targetTerm = await askForTerm('Enter the term to filter by (e.g., spring 2025, fall 2024), or press Enter for all terms: ');
    const startTime = perf_hooks_1.performance.now(); // Record start time after input
    const email = process.env.GRADESCOPE_EMAIL;
    const password = process.env.GRADESCOPE_PASSWORD;
    if (!email || !password) {
        console.error('Please set GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD environment variables');
        process.exit(1);
    }
    console.log('Starting login process...');
    const gs = new connection_1.GSConnection();
    await gs.login(email, password);
    if (!gs.account) {
        console.error('Failed to initialize account');
        process.exit(1);
    }
    // Fetch all courses first
    const allCourses = await gs.account.get_courses();
    // --- Filtering Logic ---
    let filteredCourses = { student: {}, instructor: {} };
    let courseCount = 0;
    if (targetTerm) {
        console.log(`\nFiltering for term: "${targetTerm}"`);
        // Filter student courses
        for (const [id, course] of Object.entries(allCourses.student)) {
            const typedCourse = course;
            if (typedCourse.term && typedCourse.term.toLowerCase() === targetTerm.toLowerCase()) {
                filteredCourses.student[id] = typedCourse;
                courseCount++;
            }
        }
        // Filter instructor courses
        for (const [id, course] of Object.entries(allCourses.instructor)) {
            const typedCourse = course;
            if (typedCourse.term && typedCourse.term.toLowerCase() === targetTerm.toLowerCase()) {
                filteredCourses.instructor[id] = typedCourse;
                courseCount++;
            }
        }
        if (courseCount === 0) {
            console.log(`No courses found for term "${targetTerm}".`);
            // Optionally exit if no courses found for the specific term
            // process.exit(0); 
        }
    }
    else {
        console.log('\nNo specific term provided. Showing all courses.');
        filteredCourses = allCourses; // Use all courses if no term specified
        courseCount = Object.keys(allCourses.student).length + Object.keys(allCourses.instructor).length;
    }
    // --- End Filtering Logic ---
    // Print the filtered course list
    if (courseCount > 0) {
        console.log('\nYour courses' + (targetTerm ? ` for ${targetTerm}` : '') + ':');
        console.log('-------------');
        if (Object.keys(filteredCourses.student).length > 0) {
            console.log('\nStudent courses:');
            for (const [id, course] of Object.entries(filteredCourses.student)) {
                const typedCourse = course;
                console.log(`Title: ${typedCourse.name}`);
                console.log(`Term: ${typedCourse.term}`);
                console.log(`ID: ${id}`);
                console.log(''); // Add a blank line for separation
            }
        }
        if (Object.keys(filteredCourses.instructor).length > 0) {
            console.log('\nInstructor courses:');
            for (const [id, course] of Object.entries(filteredCourses.instructor)) {
                const typedCourse = course;
                console.log(`Title: ${typedCourse.name}`);
                console.log(`Term: ${typedCourse.term}`);
                console.log(`ID: ${id}`);
                console.log(''); // Add a blank line for separation
            }
        }
    }
    // Get assignments ONLY for filtered student courses concurrently
    if (Object.keys(filteredCourses.student).length > 0) {
        console.log('\nFetching assignments concurrently for filtered student courses...');
        // Create an array of promises, one for each course's assignments
        const assignmentPromises = Object.keys(filteredCourses.student).map(courseId => gs.account.get_assignments(courseId)
            .then((assignments) => ({ courseId, assignments }))
            .catch((error) => {
            console.error(`Error fetching assignments for course ${courseId}:`, error);
            return { courseId, assignments: [], error: true };
        }));
        // Wait for all assignment fetches to complete
        const results = await Promise.all(assignmentPromises);
        // Process results after all fetches are done
        for (const result of results) {
            // Check if the result is an error object before accessing error property
            if (result.error) {
                continue; // Skip if there was an error fetching for this course
            }
            // If it's not an error, it must be a success object
            const { courseId, assignments } = result; // Destructure safely now
            const courseName = filteredCourses.student[courseId].name;
            const courseTerm = filteredCourses.student[courseId].term;
            console.log(`\nAssignments for course: ${courseName} (${courseTerm} - ${courseId})`);
            console.log('------------------------------------------');
            console.log(`Found ${assignments.length} assignments:\n`);
            if (assignments.length === 0) { // No need to check result.error here
                console.log("(No assignments found for this course)");
            }
            else {
                for (const assignment of assignments) {
                    console.log(`- ${assignment.name}`);
                    if (assignment.release_date) {
                        console.log(`  Released: ${assignment.release_date.toString()}`);
                    }
                    if (assignment.due_date) {
                        console.log(`  Due: ${assignment.due_date.toString()}`);
                    }
                    if (assignment.late_due_date) {
                        console.log(`  Late Due: ${assignment.late_due_date.toString()}`);
                    }
                    if (assignment.grade !== null && assignment.max_grade !== null) {
                        console.log(`  Grade: ${assignment.grade}/${assignment.max_grade}`);
                    }
                    else if (assignment.grade !== null) {
                        console.log(`  Grade: ${assignment.grade}`);
                    }
                    console.log(`  Status: ${assignment.submissions_status}`);
                    console.log('');
                }
            }
        }
    }
    else if (targetTerm) {
        console.log("\nNo student courses found for the specified term to fetch assignments from.");
    }
    const endTime = perf_hooks_1.performance.now(); // Record end time
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2); // Calculate duration in seconds
    console.log(`\n------------------------------------------`);
    console.log(`Script finished in ${durationSeconds} seconds.`);
}
main().catch(console.error);
//# sourceMappingURL=example.js.map