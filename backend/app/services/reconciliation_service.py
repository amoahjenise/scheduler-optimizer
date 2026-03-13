"""Reconciliation service for 28-day nurse hours tracking.

Handles:
- 28-day lookback calculation
- B-Shift (balancing shift) recommendation logic
- Vacation offset adjustments
- Compliance scoring
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from app.models import (
    Nurse, 
    NurseHoursReconciliation, 
    TimeOffRequest, 
    OptimizedSchedule
)


class ReconciliationService:
    """Service for nurse hours reconciliation and B-Shift balancing."""
    
    @staticmethod
    def calculate_28day_window(target_date: str) -> Tuple[str, str]:
        """
        Calculate the 28-day (4-week) window ending on target_date.
        
        Args:
            target_date: YYYY-MM-DD format
            
        Returns:
            Tuple of (start_date, end_date) both YYYY-MM-DD
        """
        target = datetime.strptime(target_date, "%Y-%m-%d")
        start = target - timedelta(days=27)  # 28 days inclusive
        return start.strftime("%Y-%m-%d"), target_date
    
    @staticmethod
    def get_vacation_days_in_period(
        db: Session,
        nurse_id,
        start_date: str,
        end_date: str
    ) -> Tuple[int, List[str]]:
        """
        Get count and dates of approved vacation days in period.
        
        Args:
            db: Database session
            nurse_id: UUID of nurse
            start_date: YYYY-MM-DD
            end_date: YYYY-MM-DD
            
        Returns:
            Tuple of (vacation_day_count, list of vacation dates)
        """
        requests = db.query(TimeOffRequest).filter(
            TimeOffRequest.nurse_id == nurse_id,
            TimeOffRequest.status == "approved",
            TimeOffRequest.reason.in_(["vacation", "personal"]),
            TimeOffRequest.start_date <= end_date,
            TimeOffRequest.end_date >= start_date
        ).all()
        
        vacation_dates = []
        current = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        
        for req in requests:
            req_start = datetime.strptime(req.start_date, "%Y-%m-%d")
            req_end = datetime.strptime(req.end_date, "%Y-%m-%d")
            
            # Iterate through dates in request that fall within period
            d = max(current, req_start)
            while d <= min(end, req_end):
                vacation_dates.append(d.strftime("%Y-%m-%d"))
                d += timedelta(days=1)
        
        return len(vacation_dates), vacation_dates
    
    @staticmethod
    def calculate_vacation_offset(
        vacation_days: int,
        period_weeks: int = 4
    ) -> float:
        """
        Calculate target hour reduction due to vacation.
        
        Logic: If 7+ vacation days in 4-week period, reduce target by 50%.
        
        Args:
            vacation_days: Number of vacation days
            period_weeks: Weeks in period (default 4)
            
        Returns:
            Multiplier (1.0 = no reduction, 0.5 = 50% reduction)
        """
        # If 7+ days off, reduce target by 50%
        if vacation_days >= 7:
            return 0.5
        return 1.0
    
    @staticmethod
    def calculate_hours_worked(
        db: Session,
        nurse_id,
        start_date: str,
        end_date: str
    ) -> float:
        """
        Sum paid hours from all shifts in period.
        
        Uses shift.paid_hours (total_hours - unpaid_break_hours).
        
        Args:
            db: Database session
            nurse_id: UUID of nurse
            start_date: YYYY-MM-DD
            end_date: YYYY-MM-DD
            
        Returns:
            Total paid hours worked
        """
        # Query OptimizedSchedule records for this nurse in date range
        schedules = db.query(OptimizedSchedule).filter(
            OptimizedSchedule.nurse_id == nurse_id,
            OptimizedSchedule.date >= start_date,
            OptimizedSchedule.date <= end_date,
            OptimizedSchedule.is_deleted == False
        ).all()
        
        total_paid_hours = 0.0
        
        for schedule in schedules:
            if schedule.shift_code:
                # Use paid_hours from shift_code
                total_paid_hours += schedule.shift_code.paid_hours or 0.0
        
        return total_paid_hours
    
    @staticmethod
    def calculate_balancing_shift(
        hours_worked: float,
        adjusted_target: float
    ) -> Optional[float]:
        """
        Determine if B-Shift (balancing shift) is needed and recommended hours.
        
        Logic:
        - If hours_worked < adjusted_target, suggest a shift to fill gap
        - Typically offer 8h or split shift (partial 12h)
        
        Args:
            hours_worked: Actual hours worked with vacation offset
            adjusted_target: Target hours after vacation adjustment
            
        Returns:
            Suggested hours for B-Shift, or None if not needed
        """
        delta = hours_worked - adjusted_target
        
        if delta >= 0:
            # Met or exceeded target, no B-Shift needed
            return None
        
        # Gap to fill
        gap = abs(delta)
        
        # Suggest appropriate shift size
        if gap <= 4:
            return 4.0  # Short shift
        elif gap <= 8:
            return 8.0  # Standard 8-hour shift
        else:
            return 12.0  # Full 12-hour shift (paid: 11.25)
    
    @staticmethod
    def calculate_reconciliation(
        db: Session,
        nurse: Nurse,
        period_start_date: str,
        period_end_date: str,
        organization_id: str
    ) -> NurseHoursReconciliation:
        """
        Calculate full 28-day reconciliation for a nurse.
        
        This is the main orchestration method.
        
        Args:
            db: Database session
            nurse: Nurse object
            period_start_date: YYYY-MM-DD
            period_end_date: YYYY-MM-DD
            organization_id: Org ID
            
        Returns:
            NurseHoursReconciliation object (may be unsaved)
        """
        # 1. Get vacation info
        vacation_days, _ = ReconciliationService.get_vacation_days_in_period(
            db, nurse.id, period_start_date, period_end_date
        )
        
        # 2. Calculate hours worked (raw)
        hours_worked = ReconciliationService.calculate_hours_worked(
            db, nurse.id, period_start_date, period_end_date
        )
        
        # 3. Calculate vacation offset multiplier
        vacation_offset = ReconciliationService.calculate_vacation_offset(vacation_days)
        
        # 4. Apply vacation offset
        hours_with_offset = hours_worked  # For now, no offset applied to hours_worked
        adjusted_target = nurse.bi_weekly_target_hours * 2 * vacation_offset  # 28 days = 2x bi-weekly
        
        # 5. Calculate delta
        delta = hours_worked - adjusted_target
        
        # 6. Determine if B-Shift is needed
        balancing_hours = ReconciliationService.calculate_balancing_shift(
            hours_worked, adjusted_target
        )
        balancing_needed = balancing_hours is not None
        
        # Create reconciliation record
        reconciliation = NurseHoursReconciliation(
            organization_id=organization_id,
            nurse_id=nurse.id,
            period_start_date=period_start_date,
            period_end_date=period_end_date,
            bi_weekly_target=nurse.bi_weekly_target_hours,
            hours_worked=hours_worked,
            hours_worked_with_vacation_offset=hours_with_offset,
            adjusted_target=adjusted_target,
            delta=delta,
            balancing_shift_needed=balancing_needed,
            balancing_shift_hours=balancing_hours,
            vacation_days_count=vacation_days,
            status="pending",
            notes=None
        )
        
        return reconciliation
    
    @staticmethod
    def get_compliance_score(
        db: Session,
        organization_id: str
    ) -> Dict:
        """
        Calculate organizational compliance score.
        
        "100% Compliance" = all nurses at ≤ delta tolerance (e.g., ±5 hours).
        
        Args:
            db: Database session
            organization_id: Org ID
            
        Returns:
            Dict with:
            - score: 0-100
            - total_nurses: int
            - compliant_nurses: int
            - avg_delta: float
            - nurses_needing_bshift: int
        """
        # Get latest reconciliation for each nurse
        reconciliations = db.query(NurseHoursReconciliation).filter(
            NurseHoursReconciliation.organization_id == organization_id,
            NurseHoursReconciliation.status.in_(["pending", "reconciled", "approved"])
        ).all()
        
        if not reconciliations:
            return {
                "score": 100,
                "total_nurses": 0,
                "compliant_nurses": 0,
                "avg_delta": 0.0,
                "nurses_needing_bshift": 0
            }
        
        tolerance = 5.0  # ±5 hours tolerance
        
        total = len(reconciliations)
        compliant = sum(1 for r in reconciliations if abs(r.delta) <= tolerance)
        avg_delta = sum(r.delta for r in reconciliations) / total if total > 0 else 0
        needing_bshift = sum(1 for r in reconciliations if r.balancing_shift_needed)
        
        # Score: (compliant / total) * 100
        score = int((compliant / total) * 100) if total > 0 else 100
        
        return {
            "score": score,
            "total_nurses": total,
            "compliant_nurses": compliant,
            "avg_delta": round(avg_delta, 2),
            "nurses_needing_bshift": needing_bshift
        }
    
    @staticmethod
    def get_recommended_bshifts(
        db: Session,
        organization_id: str,
        period_end_date: str
    ) -> List[Dict]:
        """
        Get list of recommended B-Shifts (balancing shifts) for the organization.
        
        Args:
            db: Database session
            organization_id: Org ID
            period_end_date: YYYY-MM-DD (period just completed)
            
        Returns:
            List of dicts:
            {
                "nurse_id": UUID,
                "nurse_name": str,
                "hours_needed": float,
                "recommended_date": str (YYYY-MM-DD),
                "delta": float,
                "priority": "high" | "medium" | "low"
            }
        """
        period_start, _ = ReconciliationService.calculate_28day_window(period_end_date)
        
        reconciliations = db.query(NurseHoursReconciliation).filter(
            NurseHoursReconciliation.organization_id == organization_id,
            NurseHoursReconciliation.period_start_date == period_start,
            NurseHoursReconciliation.period_end_date == period_end_date,
            NurseHoursReconciliation.balancing_shift_needed == True
        ).all()
        
        recommendations = []
        for recon in reconciliations:
            nurse = recon.nurse
            # Priority: higher negative delta = higher priority
            priority = "high" if recon.delta < -10 else "medium" if recon.delta < -5 else "low"
            
            recommendations.append({
                "nurse_id": str(nurse.id),
                "nurse_name": nurse.name,
                "hours_needed": recon.balancing_shift_hours or 0,
                "recommended_date": recon.balancing_shift_recommended_date or (period_end_date),
                "delta": round(recon.delta, 2),
                "priority": priority
            })
        
        # Sort by priority and delta
        priority_order = {"high": 0, "medium": 1, "low": 2}
        recommendations.sort(key=lambda x: (priority_order[x["priority"]], x["delta"]))
        
        return recommendations
