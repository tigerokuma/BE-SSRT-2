import axios from 'axios';
import * as readline from 'readline';

const API_URL = 'http://localhost:3000'; // Your backend URL
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;

async function authenticateWithGitHub() {
  try {
    // Step 1: Get the device code
    const deviceCodeResponse = await axios.post(`${API_URL}/auth/device/code`, {
      client_id: CLIENT_ID
    });

    const {
      device_code,
      user_code,
      verification_uri,
      interval
    } = deviceCodeResponse.data;

    // Step 2: Show instructions to user
    console.log('\n=== GitHub Device Flow Authentication ===');
    console.log(`\n1. Visit: ${verification_uri}`);
    console.log(`2. Enter code: ${user_code}`);
    console.log('\nWaiting for you to complete authentication...\n');

    // Step 3: Poll for token
    while (true) {
      try {
        const tokenResponse = await axios.post(`${API_URL}/auth/device/token`, {
          client_id: CLIENT_ID,
          device_code: device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        });

        if (tokenResponse.data.access_token) {
          console.log('\n✅ Successfully authenticated!');
          console.log('Token:', tokenResponse.data.access_token);
          
          // Store the token securely for future use
          // For example, in a config file or environment variable
          return tokenResponse.data;
        }
      } catch (error) {
        if (error.response?.status === 202) {
          // Still waiting for user to authorize
          process.stdout.write('.');
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
          continue;
        }

        if (error.response?.status === 429) {
          // Rate limited, wait longer
          await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000));
          continue;
        }

        if (error.response?.status === 410) {
          console.log('\n❌ Device code expired. Please try again.');
          break;
        }

        if (error.response?.status === 403) {
          console.log('\n❌ Authorization was denied.');
          break;
        }

        throw error;
      }
    }
  } catch (error) {
    console.error('Authentication error:', error.response?.data || error.message);
    throw error;
  }
}

// Run the authentication if this file is executed directly
if (require.main === module) {
  authenticateWithGitHub()
    .then(result => {
      process.exit(0);
    })
    .catch(error => {
      console.error('Failed to authenticate:', error);
      process.exit(1);
    });
}

export { authenticateWithGitHub };