import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from backend.config import settings
import pyodbc

def check_connection():
    print(f"Host: {settings.SQL_SERVER_HOST}")
    print(f"Port: {settings.SQL_SERVER_PORT}")
    print(f"Database: {settings.SQL_SERVER_DATABASE}")
    print(f"User: {settings.SQL_SERVER_USER}")
    # Don't print password

    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={settings.SQL_SERVER_HOST},{settings.SQL_SERVER_PORT};"
        f"DATABASE={settings.SQL_SERVER_DATABASE};"
        f"UID={settings.SQL_SERVER_USER};"
        f"PWD={settings.SQL_SERVER_PASSWORD}"
    )

    try:
        conn = pyodbc.connect(conn_str, timeout=5)
        print("Connection successful!")
        cursor = conn.cursor()
        cursor.execute("SELECT @@VERSION")
        row = cursor.fetchone()
        print(f"SQL Server Version: {row[0]}")
        conn.close()
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    check_connection()
