from app.db.database import Base, engine
from app.models import user, schedule, optimized_schedule

def init_db():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init_db()
    print("Tables created successfully.")
