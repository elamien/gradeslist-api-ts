import * as dotenv from 'dotenv';
import { GSConnection } from './connection'; // Assuming GSConnection is the correct export

// Load environment variables from .env file
dotenv.config();

const ASSIGNMENT_URL = 'https://www.gradescope.com/courses/952770/assignments/6007368'; // Point to assignment page

async function main() {
  const email = process.env.GRADESCOPE_EMAIL;
  const password = process.env.GRADESCOPE_PASSWORD;

  if (!email || !password) {
    console.error('Error: GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD must be set in the .env file.');
    process.exit(1);
  }

  const gs = new GSConnection();

  try {
    console.log(`Attempting to log in as ${email}...`);
    const loggedIn = await gs.login(email, password);

    if (!loggedIn) {
      console.error('Login failed. Please check your credentials and network connection.');
      process.exit(1);
    }

    console.log('Login successful!');
    console.log(`Fetching HTML for assignment page: ${ASSIGNMENT_URL}...`);

    const htmlContent = await gs.getHtml(ASSIGNMENT_URL);

    console.log('\n--- START OF HTML CONTENT ---');
    console.log(htmlContent);
    console.log('--- END OF HTML CONTENT ---\n');

    // Next step: Analyze the printed HTML to find the submission time element.

  } catch (error) {
    console.error('An error occurred:', error);
    process.exit(1);
  }
}

main(); 