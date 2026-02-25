Link to view the project :- https://quiz-craft1.netlify.app/
QuizCraft — Class Presentation Speech

"Hello everyone, I'm going to present my project called QuizCraft — an online quiz platform where users can create, play, and manage quizzes.

What does it do?
"QuizCraft lets you sign up, log in, and create your own quizzes with multiple choice questions. Other users can browse and play those quizzes. You also get a personal dashboard showing your quiz history and scores."

Tech Stack:
"For the frontend I used simple HTML, CSS and JavaScript — deployed on Netlify. For the backend I built a REST API using Flask, a Python framework — deployed on Render. And for the database I used Firebase Firestore by Google."

The 3 Project Requirements:
1. Authentication & Access Control:
"Users register and login using Firebase Authentication. Every API request sends a token to Flask which verifies — is this user really who they claim to be? If not, access is denied. Also, only the quiz owner can edit or delete their own quiz — that's access control."
2. Database with CRUD:
"CRUD means Create, Read, Update, Delete. In my project:

Create → User publishes a new quiz
Read → Browse page loads all public quizzes
Update → Play count updates after each game
Delete → Owner can delete their quiz"

3. Flask Backend:
"Flask acts as a secure middle layer between the frontend and database. Instead of the frontend talking directly to the database, every request goes through Flask which validates the data and checks permissions first."

Architecture in simple words:
"Think of it like a restaurant. The customer is the frontend, the waiter is Flask, and the kitchen is Firebase. The customer never goes directly to the kitchen — everything goes through the waiter who checks your order is valid first."

Deployment:
"Frontend is live on Netlify, backend is live on Render — both are free cloud platforms. So anyone in the world can access QuizCraft right now at quiz-craft1.netlify.app"

Thank you!"
