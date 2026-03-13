"""Patient model for handover tool."""
from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from uuid import uuid4
from app.db.database import Base


class Patient(Base):
    """
    Patient record for the HEMA-ONCOLOGY unit.
    Represents current patients on the unit for handover purposes.
    """
    __tablename__ = "patients"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    organization_id = Column(String, nullable=True, index=True)  # Multi-tenant org ID
    
    # Basic patient info
    mrn = Column(String(50), nullable=True, index=True)  # Medical Record Number - optional
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    date_of_birth = Column(DateTime, nullable=True)
    age = Column(String(50), nullable=True)  # Stored as input, e.g., "12 months" or "5 years"
    
    # Location
    room_number = Column(String(20), nullable=False)
    bed = Column(String(10), nullable=True)  # e.g., "A" or "B" for shared rooms
    
    # Clinical info
    diagnosis = Column(String(255), nullable=True)
    attending_physician = Column(String(100), nullable=True)
    admission_date = Column(DateTime, nullable=True)
    
    # Status
    is_active = Column(Boolean, default=True)  # False when discharged
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    handovers = relationship("Handover", back_populates="patient", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Patient {self.last_name}, {self.first_name} - Room {self.room_number}>"
    
    @property
    def full_name(self):
        return f"{self.last_name}, {self.first_name}"
