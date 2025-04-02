import * as dotenv from 'dotenv';
import { GSConnection } from './connection';
import { Course } from './types';
import { DateTime } from 'luxon';

// Load environment variables
dotenv.config();

async function main() {
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

  const courses = await gs.account.get_courses();
  
  console.log('\nYour courses:');
  console.log('-------------');
  
  console.log('\nStudent courses:');
  for (const [id, course] of Object.entries(courses.student)) {
    const typedCourse = course as Course;
    console.log(`- ${typedCourse.name} (${typedCourse.term}) [ID: ${id}]`);
  }

  console.log('\nInstructor courses:');
  for (const [id, course] of Object.entries(courses.instructor)) {
    const typedCourse = course as Course;
    console.log(`- ${typedCourse.name} (${typedCourse.term}) [ID: ${id}]`);
  }

  // Get assignments for all student courses
  console.log('\nFetching assignments for all student courses...');
  for (const courseId of Object.keys(courses.student)) {
    const courseName = (courses.student[courseId] as Course).name;
    console.log(`\nAssignments for course: ${courseName} (${courseId})`);
    console.log('------------------------------------------');
    try {
      const assignments = await gs.account.get_assignments(courseId);
      console.log(`Found ${assignments.length} assignments:\n`);
      
      if (assignments.length === 0) {
        console.log("(No assignments found for this course)");
      } else {
        for (const assignment of assignments) {
          console.log(`- ${assignment.name}`);
          if (assignment.release_date) {
            console.log(`  Released: ${assignment.release_date.toLocaleString(DateTime.DATETIME_SHORT)}`);
          }
          if (assignment.due_date) {
            console.log(`  Due: ${assignment.due_date.toLocaleString(DateTime.DATETIME_SHORT)}`);
          }
          if (assignment.late_due_date) {
            console.log(`  Late Due: ${assignment.late_due_date.toLocaleString(DateTime.DATETIME_SHORT)}`);
          }
          if (assignment.grade !== null && assignment.max_grade !== null) {
            console.log(`  Grade: ${assignment.grade}/${assignment.max_grade}`);
          } else if (assignment.grade !== null) {
            console.log(`  Grade: ${assignment.grade}`); // Handle cases where max_grade might be null
          }
          console.log(`  Status: ${assignment.submissions_status}`);
          console.log(''); // Add a blank line for readability
        }
      }
    } catch (error) {
        console.error(`Error fetching assignments for course ${courseId}:`, error);
    }
  }
}

main().catch(console.error); 