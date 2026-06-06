#!/usr/bin/env python3
import requests
import os

API_BASE = "http://localhost:8000"

# Test upload with a sample file
sample_files = [
    "test1.mp4",
    "test2.mp4"  # These don't exist, just testing the API
]

# First check health
try:
    response = requests.get(f"{API_BASE}/health")
    print("Health check:", response.json())
except Exception as e:
    print(f"Health check failed: {e}")
    exit(1)

# Create dummy files for testing
os.makedirs("uploads", exist_ok=True)

# Test with non-existing files
files = [("files", open("nonexistent.mp4", "rb"))] if False else []

if files:
    try:
        response = requests.post(f"{API_BASE}/upload", files=files)
        print("Upload response:", response.status_code, response.text)
    except Exception as e:
        print(f"Upload failed: {e}")