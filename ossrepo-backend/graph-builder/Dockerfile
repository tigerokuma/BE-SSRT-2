FROM python:3.11-slim

# System deps (you may need more if tree-sitter grammars compile at runtime)
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your app
COPY . .

# Environment defaults (override via docker-compose or env on server)
ENV MEMGRAPH_HOST=memgraph
ENV MEMGRAPH_PORT=7687
ENV BACKEND_MODE=online
ENV BACKEND_URL=http://localhost:3000
ENV OFFLINE_OUT_DIR=.offline_out

# Expose the FastAPI port
EXPOSE 8080

# Run the FastAPI app
CMD ["uvicorn", "builder.main:app", "--host", "0.0.0.0", "--port", "8080"]
