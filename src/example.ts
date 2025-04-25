import * as dotenv from 'dotenv';
import * as readline from 'readline'; // Import readline
import { GSConnection } from './connection';
import { Course, Assignment } from './types';
import { DateTime } from 'luxon';
import { performance } from 'perf_hooks'; // Import performance
import * as cheerio from 'cheerio'; // Import cheerio

// Define types for the Promise.all result
type AssignmentFetchSuccess = { courseId: string; assignments: Assignment[]; error?: false };
type AssignmentFetchError = { courseId: string; assignments: []; error: true };
type AssignmentFetchResult = AssignmentFetchSuccess | AssignmentFetchError;

// Define types for submission time fetching
type SubmissionTimeTask = {
  submissionUrl: string;
  courseId: string;
  assignmentId: string;
  assignmentName: string; // For error logging
};
type SubmissionTimeResult = {
  courseId: string;
  assignmentId: string;
  submissionTimeStr: string;
  error?: any; // Store potential errors
};

// Function to ask user for term
function askForTerm(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim()); // Trim whitespace from the answer
  }))
}

// Load environment variables
dotenv.config();

async function main() {
  // Ask the user for the target term first
  const targetTerm = await askForTerm('Enter the term to filter by (e.g., spring 2025, fall 2024), or press Enter for all terms: ');
  
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

  // Fetch all courses first
  const allCourses = await gs.account.get_courses();
  
  // --- Filtering Logic ---
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
      // Optionally exit if no courses found for the specific term
      // process.exit(0); 
    }
  } else {
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
    const typedCourse = course as Course;
            console.log(`Title: ${typedCourse.name}`);
            console.log(`Term: ${typedCourse.term}`);
            console.log(`ID: ${id}`);
            console.log(''); // Add a blank line for separation
        }
    }

    if (Object.keys(filteredCourses.instructor).length > 0) {
  console.log('\nInstructor courses:');
        for (const [id, course] of Object.entries(filteredCourses.instructor)) {
    const typedCourse = course as Course;
            console.log(`Title: ${typedCourse.name}`);
            console.log(`Term: ${typedCourse.term}`);
            console.log(`ID: ${id}`);
            console.log(''); // Add a blank line for separation
        }
    }
  }

  // Get assignments ONLY for filtered student courses concurrently
  let assignmentResults: AssignmentFetchResult[] = [];
  if (Object.keys(filteredCourses.student).length > 0) {
    console.log('\nFetching assignments concurrently for filtered student courses...');

    // Create an array of promises, one for each course's assignments
    const assignmentPromises: Promise<AssignmentFetchResult>[] = Object.keys(filteredCourses.student).map(courseId => 
      gs.account!.get_assignments(courseId)
        .then((assignments: Assignment[]): AssignmentFetchSuccess => ({ courseId, assignments })) 
        .catch((error: any): AssignmentFetchError => { 
          console.error(`Error fetching assignments for course ${courseId}:`, error);
          return { courseId, assignments: [], error: true };
        })
    );

    // Wait for all assignment fetches to complete
    assignmentResults = await Promise.all(assignmentPromises);
  } else if (targetTerm) {
    console.log("\nNo student courses found for the specified term to fetch assignments from.");
  }

  // --- Collect Submission Time Fetch Tasks ---
  const submissionTimeTasks: SubmissionTimeTask[] = [];
  for (const result of assignmentResults) {
    if (result.error) continue;
    const { courseId, assignments } = result;
    const courseBaseUrl = `https://www.gradescope.com/courses/${courseId}`;

    for (const assignment of assignments) {
      const isSubmitted = assignment.submissions_status === 'Submitted' || assignment.submissions_status === 'Graded' || assignment.submissions_status.startsWith('Submitted (') || assignment.submissions_status.startsWith('Graded (');
      if (isSubmitted && assignment.submission_id) {
        submissionTimeTasks.push({
          submissionUrl: `${courseBaseUrl}/assignments/${assignment.id}/submissions/${assignment.submission_id}`,
          courseId: courseId,
          assignmentId: assignment.id,
          assignmentName: assignment.name
        });
      }
    }
  }
  // --- End Collect Tasks ---


  // --- Fetch Submission Times Concurrently ---
  const submissionTimeMap = new Map<string, string>(); // Key: "courseId_assignmentId", Value: submissionTimeStr
  if (submissionTimeTasks.length > 0) {
      console.log(`\nFetching submission details concurrently for ${submissionTimeTasks.length} submitted assignments...`);
      const submissionTimePromises: Promise<SubmissionTimeResult>[] = submissionTimeTasks.map(async (task) => {
          try {
              // Reduced delay (e.g., 200ms) as requests are concurrent
              await new Promise(resolve => setTimeout(resolve, 200)); 

              const htmlContent = await gs.getHtml(task.submissionUrl);
              const $ = cheerio.load(htmlContent);
              const reactProps = $('div[data-react-class="AssignmentSubmissionViewer"]').attr('data-react-props');
              let submissionTimeStr = '';

              if (reactProps) {
                  const propsJson = JSON.parse(reactProps);
                  if (propsJson.assignment_submission && propsJson.assignment_submission.created_at) {
                      const createdAtIso = propsJson.assignment_submission.created_at;
                      submissionTimeStr = DateTime.fromISO(createdAtIso).toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS);
                  } else {
                      console.log(`  Warning: Could not find created_at in react props for assignment ${task.assignmentName} (Course ${task.courseId})`);
                  }
              } else {
                  console.log(`  Warning: Could not find react props div for assignment ${task.assignmentName} (Course ${task.courseId})`);
              }
              return { ...task, submissionTimeStr };
          } catch (error) {
              console.error(`  Error processing submission for ${task.assignmentName} (Course ${task.courseId}, Assign ${task.assignmentId}):`, error instanceof Error ? error.message : error);
              return { ...task, submissionTimeStr: '', error: error }; // Include error info
          }
      });

      const submissionTimeResults = await Promise.all(submissionTimePromises);

      // Populate the map
      for (const res of submissionTimeResults) {
          if (!res.error && res.submissionTimeStr) {
              submissionTimeMap.set(`${res.courseId}_${res.assignmentId}`, res.submissionTimeStr);
          }
      }
      console.log("Finished fetching submission details.");
  }
  // --- End Fetch Submission Times ---


  // --- Print Final Results ---
  for (const result of assignmentResults) {
    if (result.error) { 
        continue; 
    }
    const { courseId, assignments } = result; 

    const courseName = (filteredCourses.student[courseId] as Course).name;
    const courseTerm = (filteredCourses.student[courseId] as Course).term;

    console.log(`\nAssignments for course: ${courseName} (${courseTerm} - ${courseId})`);
    console.log('------------------------------------------');
    console.log(`Found ${assignments.length} assignments:\n`);
    
    if (assignments.length === 0) { 
      console.log("(No assignments found for this course)");
    } else {
      for (const assignment of assignments) {
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

        // Check if submission time was fetched
        const submissionTimeStr = submissionTimeMap.get(`${courseId}_${assignment.id}`);
        const isSubmittedStatus = assignment.submissions_status === 'Submitted' || assignment.submissions_status === 'Graded' || assignment.submissions_status.startsWith('Submitted (') || assignment.submissions_status.startsWith('Graded (');

        if (submissionTimeStr) { 
          console.log(`  Submitted At: ${submissionTimeStr}`);
        } else if (isSubmittedStatus && !assignment.submission_id) {
          console.log(`  Submitted At: (Could not retrieve submission ID)`);
        } else if (isSubmittedStatus) {
           // If status implies submitted but no time found in map (likely due to fetch error or missing react props)
           console.log(`  Submitted At: (Failed to retrieve time - check errors above)`);
        }
        console.log(''); // Blank line for separation
      }
    }
  }
  // --- End Print Final Results ---

  const endTime = performance.now(); // Record end time
  const durationSeconds = ((endTime - startTime) / 1000).toFixed(2); // Calculate duration in seconds
  console.log(`\n------------------------------------------`);
  console.log(`Script finished in ${durationSeconds} seconds.`);
}

main().catch(console.error); 