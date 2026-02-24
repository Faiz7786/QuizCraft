"""
QuizCraft — Flask Backend (app.py)
===================================
Handles server-side logic, Firebase Admin SDK verification,
and acts as a secure API layer between frontend and Firestore.

Run locally:
    python app.py

Endpoints:
    POST /api/verify-token     → Verify Firebase ID token
    GET  /api/quizzes          → Get all public quizzes
    GET  /api/quizzes/<id>     → Get single quiz
    POST /api/quizzes          → Create quiz (auth required)
    PUT  /api/quizzes/<id>     → Update quiz (owner only)
    DELETE /api/quizzes/<id>   → Delete quiz (owner only)
    POST /api/quizzes/<id>/play → Increment play count
    GET  /api/stats            → Get global stats
    GET  /api/my-quizzes       → Get quizzes by current user (auth required)
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, auth, firestore
from functools import wraps
from datetime import datetime
from dotenv import load_dotenv

# ─── Load environment variables from .env ──────────────────────
load_dotenv()

# ─── Flask App Setup ───────────────────────────────────────────
app = Flask(__name__)

# Allow requests from your frontend (localhost dev + Netlify)
CORS(app, resources={
    r"/api/*": {
        "origins": [
            "http://localhost:3000",
            "http://127.0.0.1:5500",
            "http://localhost:5500",
            os.getenv("FRONTEND_URL", "*")   # set this in .env for production
        ]
    }
})

# ─── Firebase Admin SDK Init ───────────────────────────────────
# Uses your service account key JSON file path from .env
cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "serviceAccountKey.json")

if not firebase_admin._apps:
    try:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        print("✅ Firebase Admin initialized successfully")
    except Exception as e:
        print(f"❌ Firebase init error: {e}")
        print("   Make sure serviceAccountKey.json exists in the backend/ folder")
        print("   See README.md Step 3 for instructions")

db = firestore.client()

# ─── Auth Middleware ───────────────────────────────────────────
def require_auth(f):
    """Decorator: verify Firebase ID token from Authorization header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        id_token = auth_header.split("Bearer ")[1]
        try:
            decoded = auth.verify_id_token(id_token)
            request.user = decoded          # attach user info to request
            return f(*args, **kwargs)
        except auth.ExpiredIdTokenError:
            return jsonify({"error": "Token expired. Please log in again."}), 401
        except auth.InvalidIdTokenError:
            return jsonify({"error": "Invalid token."}), 401
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    return decorated


def optional_auth(f):
    """Decorator: attach user if token present, but don't block if not."""
    @wraps(f)
    def decorated(*args, **kwargs):
        request.user = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                decoded = auth.verify_id_token(auth_header.split("Bearer ")[1])
                request.user = decoded
            except Exception:
                pass
        return f(*args, **kwargs)
    return decorated


# ─── Helper Functions ──────────────────────────────────────────
def quiz_to_dict(doc):
    """Convert Firestore document to JSON-safe dict."""
    data = doc.to_dict()
    data["id"] = doc.id
    # Convert Firestore Timestamp → ISO string
    if data.get("createdAt"):
        try:
            data["createdAt"] = data["createdAt"].isoformat()
        except Exception:
            data["createdAt"] = str(data["createdAt"])
    return data


def error_response(message, status=400):
    return jsonify({"error": message, "success": False}), status


def success_response(data=None, message="Success", status=200):
    payload = {"success": True, "message": message}
    if data is not None:
        payload["data"] = data
    return jsonify(payload), status


# ═══════════════════════════════════════════════════════════════
#  ROUTES
# ═══════════════════════════════════════════════════════════════

# ─── Health Check ─────────────────────────────────────────────
@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "app":     "QuizCraft API",
        "status":  "running",
        "version": "1.0.0"
    })


# ─── Verify Token ─────────────────────────────────────────────
@app.route("/api/verify-token", methods=["POST"])
@require_auth
def verify_token():
    """Frontend can call this to confirm the token is valid."""
    return success_response({
        "uid":   request.user["uid"],
        "email": request.user.get("email"),
        "name":  request.user.get("name")
    }, "Token is valid")


# ─── GET /api/quizzes — List public quizzes ───────────────────
@app.route("/api/quizzes", methods=["GET"])
@optional_auth
def get_quizzes():
    try:
        query = db.collection("quizzes") \
                  .where("visibility", "==", "public") \
                  .order_by("createdAt", direction=firestore.Query.DESCENDING) \
                  .limit(50)

        docs   = query.stream()
        quizzes = [quiz_to_dict(d) for d in docs]
        return success_response(quizzes)

    except Exception as e:
        return error_response(str(e), 500)


# ─── GET /api/quizzes/<id> — Single quiz ─────────────────────
@app.route("/api/quizzes/<quiz_id>", methods=["GET"])
@optional_auth
def get_quiz(quiz_id):
    try:
        doc = db.collection("quizzes").document(quiz_id).get()
        if not doc.exists:
            return error_response("Quiz not found", 404)

        data = quiz_to_dict(doc)

        # Private quizzes: only owner can access
        if data.get("visibility") == "private":
            if not request.user or request.user["uid"] != data.get("authorId"):
                return error_response("This quiz is private", 403)

        return success_response(data)

    except Exception as e:
        return error_response(str(e), 500)


# ─── POST /api/quizzes — Create quiz ─────────────────────────
@app.route("/api/quizzes", methods=["POST"])
@require_auth
def create_quiz():
    body = request.get_json(silent=True)
    if not body:
        return error_response("Request body must be JSON")

    # Validate required fields
    title     = (body.get("title") or "").strip()
    questions = body.get("questions", [])

    if not title:
        return error_response("Quiz title is required")
    if len(title) > 120:
        return error_response("Title must be under 120 characters")
    if not questions or len(questions) == 0:
        return error_response("At least one question is required")
    if len(questions) > 50:
        return error_response("Maximum 50 questions allowed")

    # Validate each question
    for i, q in enumerate(questions):
        if not q.get("text", "").strip():
            return error_response(f"Question {i+1} is missing text")
        if len(q.get("options", [])) != 4:
            return error_response(f"Question {i+1} must have exactly 4 options")
        if q.get("correct") not in [0, 1, 2, 3]:
            return error_response(f"Question {i+1} has invalid correct answer index")

    visibility = body.get("visibility", "public")
    if visibility not in ["public", "private"]:
        visibility = "public"

    quiz_data = {
        "title":       title,
        "description": (body.get("description") or "").strip()[:500],
        "category":    body.get("category", "General Knowledge"),
        "visibility":  visibility,
        "questions":   questions,
        "authorId":    request.user["uid"],
        "authorName":  request.user.get("name", request.user.get("email", "Anonymous")),
        "plays":       0,
        "createdAt":   firestore.SERVER_TIMESTAMP,
    }

    try:
        ref = db.collection("quizzes").document()
        ref.set(quiz_data)

        # Update global stats
        db.collection("stats").document("global").set(
            {"quizzes": firestore.Increment(1)},
            merge=True
        )

        return success_response({"id": ref.id}, "Quiz created successfully", 201)

    except Exception as e:
        return error_response(str(e), 500)


# ─── PUT /api/quizzes/<id> — Update quiz ─────────────────────
@app.route("/api/quizzes/<quiz_id>", methods=["PUT"])
@require_auth
def update_quiz(quiz_id):
    try:
        doc = db.collection("quizzes").document(quiz_id).get()
        if not doc.exists:
            return error_response("Quiz not found", 404)

        data = doc.to_dict()
        # Only owner can update
        if data.get("authorId") != request.user["uid"]:
            return error_response("You don't have permission to edit this quiz", 403)

        body = request.get_json(silent=True) or {}

        # Only allow updating these fields
        allowed  = ["title", "description", "category", "visibility", "questions"]
        updates  = {k: v for k, v in body.items() if k in allowed}

        if "title" in updates and not updates["title"].strip():
            return error_response("Title cannot be empty")

        db.collection("quizzes").document(quiz_id).update(updates)
        return success_response(message="Quiz updated successfully")

    except Exception as e:
        return error_response(str(e), 500)


# ─── DELETE /api/quizzes/<id> — Delete quiz ──────────────────
@app.route("/api/quizzes/<quiz_id>", methods=["DELETE"])
@require_auth
def delete_quiz(quiz_id):
    try:
        doc = db.collection("quizzes").document(quiz_id).get()
        if not doc.exists:
            return error_response("Quiz not found", 404)

        data = doc.to_dict()
        if data.get("authorId") != request.user["uid"]:
            return error_response("You don't have permission to delete this quiz", 403)

        db.collection("quizzes").document(quiz_id).delete()

        # Update stats
        db.collection("stats").document("global").set(
            {"quizzes": firestore.Increment(-1)},
            merge=True
        )

        return success_response(message="Quiz deleted successfully")

    except Exception as e:
        return error_response(str(e), 500)


# ─── POST /api/quizzes/<id>/play — Increment play count ──────
@app.route("/api/quizzes/<quiz_id>/play", methods=["POST"])
def increment_plays(quiz_id):
    try:
        db.collection("quizzes").document(quiz_id).update(
            {"plays": firestore.Increment(1)}
        )
        db.collection("stats").document("global").set(
            {"plays": firestore.Increment(1)},
            merge=True
        )
        return success_response(message="Play recorded")

    except Exception as e:
        return error_response(str(e), 500)


# ─── GET /api/my-quizzes — Auth user's quizzes ───────────────
@app.route("/api/my-quizzes", methods=["GET"])
@require_auth
def my_quizzes():
    try:
        docs = db.collection("quizzes") \
                 .where("authorId", "==", request.user["uid"]) \
                 .order_by("createdAt", direction=firestore.Query.DESCENDING) \
                 .stream()

        quizzes = [quiz_to_dict(d) for d in docs]
        return success_response(quizzes)

    except Exception as e:
        return error_response(str(e), 500)


# ─── GET /api/stats — Global stats ───────────────────────────
@app.route("/api/stats", methods=["GET"])
def get_stats():
    try:
        doc  = db.collection("stats").document("global").get()
        data = doc.to_dict() if doc.exists else {}
        return success_response({
            "quizzes": data.get("quizzes", 0),
            "users":   data.get("users",   0),
            "plays":   data.get("plays",   0),
        })
    except Exception as e:
        return error_response(str(e), 500)


# ─── 404 / 405 handlers ───────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return error_response("Route not found", 404)

@app.errorhandler(405)
def method_not_allowed(e):
    return error_response("Method not allowed", 405)


# ─── Run ──────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    print(f"\n🚀 QuizCraft API running at http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)