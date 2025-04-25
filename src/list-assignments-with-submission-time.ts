import * as dotenv from 'dotenv';
import * as readline from 'readline';
import { GSConnection } from './connection';
import { Course, Assignment } from './types';
import { DateTime } from 'luxon';
import { performance } from 'perf_hooks';
import * as cheerio from 'cheerio'; // Import cheerio

// Define types for the Promise.all result
type AssignmentFetchSuccess = { courseId: string; assignments: Assignment[]; error?: false };
type AssignmentFetchError = { courseId: string; assignments: []; error: true };
type AssignmentFetchResult = AssignmentFetchSuccess | AssignmentFetchError;

// Function to ask user for term
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
  const targetTerm = await askForTerm('Enter the term to filter by (e.g., spring 2025, fall 2024), or press Enter for all terms: ');
  
  const startTime = performance.now();

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

  // Original script logic starts here
  const allCourses = await gs.account.get_courses();
    
  let filteredCourses: { student: Record<string, Course>; instructor: Record<string, Course>; } = { student: {}, instructor: {} };
  let courseCount = 0;

  if (targetTerm) {
    console.log(`\nFiltering for term: "${targetTerm}"`);

    for (const [id, course] of Object.entries(allCourses.student)) {
      const typedCourse = course as Course;
      if (typedCourse.term && typedCourse.term.toLowerCase() === targetTerm.toLowerCase()) {
        filteredCourses.student[id] = typedCourse;
        courseCount++;
      }
    }
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
    filteredCourses = allCourses;
    courseCount = Object.keys(allCourses.student).length + Object.keys(allCourses.instructor).length;
  }

  if (courseCount > 0) {
    console.log('\nYour courses' + (targetTerm ? ` for ${targetTerm}` : '') + ':');
    console.log('-------------');

    if (Object.keys(filteredCourses.student).length > 0) {
      console.log('\nStudent courses:');
      for (const [id, course] of Object.entries(filteredCourses.student)) {
        const typedCourse = course as Course;
        console.log(`Title: ${typedCourse.name}`);
        console.log(`Term: ${typedCourse.term}`);
        console.log(`ID: ${id}`);
        console.log('');
      }
    }

    if (Object.keys(filteredCourses.instructor).length > 0) {
      console.log('\nInstructor courses:');
      for (const [id, course] of Object.entries(filteredCourses.instructor)) {
        const typedCourse = course as Course;
        console.log(`Title: ${typedCourse.name}`);
        console.log(`Term: ${typedCourse.term}`);
        console.log(`ID: ${id}`);
        console.log('');
      }
    }
  }

  if (Object.keys(filteredCourses.student).length > 0) {
    console.log('\nFetching assignments concurrently for filtered student courses...');

    const assignmentPromises: Promise<AssignmentFetchResult>[] = Object.keys(filteredCourses.student).map(courseId =>
      gs.account!.get_assignments(courseId)
        .then((assignments: Assignment[]): AssignmentFetchSuccess => ({ courseId, assignments }))
        .catch((error: any): AssignmentFetchError => {
          console.error(`Error fetching assignments for course ${courseId}:`, error);
          return { courseId, assignments: [], error: true };
        })
    );

    const results: AssignmentFetchResult[] = await Promise.all(assignmentPromises);

    for (const result of results) {
      if (result.error) {
          continue;
      }

      const { courseId, assignments } = result;

      const courseName = (filteredCourses.student[courseId] as Course).name;
      const courseTerm = (filteredCourses.student[courseId] as Course).term;
      const courseBaseUrl = `https://www.gradescope.com/courses/${courseId}`;

      console.log(`\nAssignments for course: ${courseName} (${courseTerm} - ${courseId})`);
      console.log('------------------------------------------');
      console.log(`Found ${assignments.length} assignments:\n`);

      if (assignments.length === 0) {
        console.log("(No assignments found for this course)");
      } else {
        // Fetch submission times sequentially for submitted assignments
        for (const assignment of assignments) {
          let submissionTimeStr = '';
          // Check if status indicates a submission exists AND if we have a submission_id
          // Also check for statuses like "Submitted (Late)"
          const isSubmitted = assignment.submissions_status === 'Submitted' || assignment.submissions_status === 'Graded' || assignment.submissions_status.startsWith('Submitted (') || assignment.submissions_status.startsWith('Graded (');
          
          if (isSubmitted && assignment.submission_id) { // Check for submission_id directly
            try {
              // Add a small delay to potentially avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

              // Construct the direct submission URL
              const submissionUrl = `${courseBaseUrl}/assignments/${assignment.id}/submissions/${assignment.submission_id}`;
              
              const htmlContent = await gs.getHtml(submissionUrl); // Fetch submission page
              const $ = cheerio.load(htmlContent);
              const reactProps = $('div[data-react-class="AssignmentSubmissionViewer"]').attr('data-react-props');

              if (reactProps) {
                const propsJson = JSON.parse(reactProps);
                if (propsJson.assignment_submission && propsJson.assignment_submission.created_at) {
                  const createdAtIso = propsJson.assignment_submission.created_at;
                  submissionTimeStr = DateTime.fromISO(createdAtIso).toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS);
                } else {
                   // This warning might appear if the react props structure changed slightly
                   console.log(`  Warning: Could not find created_at in react props for assignment ${assignment.name}`);
                }
              } else {
                 // This warning might appear if the submission page didn't load correctly or structure changed
                 console.log(`  Warning: Could not find react props div for assignment ${assignment.name}`);
              }
            } catch (error) {
              // Log specific error during submission fetch/parse
              console.error(`  Error processing submission for ${assignment.name} (Sub ID: ${assignment.submission_id}):`, error instanceof Error ? error.message : error);
            }
          }

          // Print assignment details
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
          } else if (assignment.grade !== null) {
            console.log(`  Grade: ${assignment.grade}`);
          }
          console.log(`  Status: ${assignment.submissions_status}`);
          if (submissionTimeStr) { // Only print if we found a submission time
            console.log(`  Submitted At: ${submissionTimeStr}`);
          } else if (isSubmitted && !assignment.submission_id) {
            // Add a note if it was submitted but we couldn't get the submission_id
            console.log(`  Submitted At: (Could not retrieve submission ID)`);
          } else if (isSubmitted) {
             // Add a note if it was submitted, we had an ID, but still failed to get time
             console.log(`  Submitted At: (Failed to retrieve time - check errors above)`);
          }
          console.log(''); // Blank line for separation
        }
      }
    }
  } else if (targetTerm) {
    console.log("\nNo student courses found for the specified term to fetch assignments from.");
  }

  const endTime = performance.now();
  const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`\n------------------------------------------`);
  console.log(`Script finished in ${durationSeconds} seconds.`);
}

main().catch(console.error); 