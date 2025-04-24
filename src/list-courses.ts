import * as dotenv from 'dotenv';
import * as readline from 'readline';
import { GSConnection } from './connection';
import { Account } from './account';
import { Course, Assignment } from './types'; // Keep Assignment for type compatibility if needed indirectly, or remove later if safe
import { performance } from 'perf_hooks';

// Function to ask user for term (same as in example.ts)
function askForTerm(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim());
  }))
}

// Load environment variables
dotenv.config();

async function main() {
  // Ask the user for the target term first
  const targetTerm = await askForTerm('Enter the term to list courses for (e.g., spring 2025, fall 2024), or press Enter for all terms: ');
  
  const startTime = performance.now(); // Record start time after input

  const email = process.env.GRADESCOPE_EMAIL;
  const password = process.env.GRADESCOPE_PASSWORD;

  if (!email || !password) {
    console.error('Please set GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD environment variables');
    process.exit(1);
  }

  console.log('Starting login process...');
  const gs = new GSConnection();
  await gs.login(email, password);

  if (!gs.account) {
    console.error('Failed to initialize account');
    process.exit(1);
  }

  console.log('Fetching course list...');
  // Fetch all courses first
  const allCourses = await gs.account.get_courses();

  // --- Filtering Logic (same as example.ts) ---
  let filteredCourses: { student: Record<string, Course>; instructor: Record<string, Course>; } = { student: {}, instructor: {} };
  let courseCount = 0;

  if (targetTerm) {
    console.log(`\nFiltering for term: "${targetTerm}"`);
    
    // Filter student courses
    for (const [id, course] of Object.entries(allCourses.student)) {
      const typedCourse = course as Course;
      if (typedCourse.term && typedCourse.term.toLowerCase() === targetTerm.toLowerCase()) {
        filteredCourses.student[id] = typedCourse;
        courseCount++;
      }
    }
    // Filter instructor courses
    for (const [id, course] of Object.entries(allCourses.instructor)) {
       const typedCourse = course as Course;
       if (typedCourse.term && typedCourse.term.toLowerCase() === targetTerm.toLowerCase()) {
        filteredCourses.instructor[id] = typedCourse;
        courseCount++;
      }
    }
    
    if (courseCount === 0) {
      console.log(`No courses found for term "${targetTerm}".`);
    }
  } else {
    console.log('\nNo specific term provided. Showing all courses.');
    filteredCourses = allCourses; // Use all courses if no term specified
    courseCount = Object.keys(allCourses.student).length + Object.keys(allCourses.instructor).length;
  }
  // --- End Filtering Logic ---

  // --- Print ONLY Course Titles ---
  if (courseCount > 0) {
    console.log('\nFiltered Course Titles:');
    console.log('-------------------------');
    
    const allFilteredCourses = [
        ...Object.values(filteredCourses.student),
        ...Object.values(filteredCourses.instructor)
    ];

    // Print titles directly in the desired format
    allFilteredCourses.forEach(course => {
        console.log(`Title: ${course.name}`);
    });

  } else if (!targetTerm) {
      console.log("\nNo courses found on the account.");
  } else {
      // This handles the case where a term was specified but no courses were found
      // The "No courses found for term..." message is already printed in the filtering logic
  }
  // --- End Printing Titles ---

  const endTime = performance.now(); // Record end time
  const durationSeconds = ((endTime - startTime) / 1000).toFixed(2); // Calculate duration
  console.log(`\n------------------------------------------`);
  console.log(`Script finished in ${durationSeconds} seconds.`);
}

main().catch(console.error); 