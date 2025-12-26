import logging
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException

from backend.auth.dependencies import get_current_user
from backend.sql_server_connector import sql_connector

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/locations", tags=["Locations"])


@router.get("/warehouses", response_model=List[dict[str, Any]])
async def get_warehouses(current_user: dict = Depends(get_current_user)):
    """Fetch all warehouses from ERP"""
    try:
        # Ensure connection is alive
        if not sql_connector.test_connection():
             raise HTTPException(status_code=503, detail="Database connection unavailable")

        warehouses = sql_connector.get_all_warehouses()
        return warehouses
    except Exception as e:
        logger.error(f"Error fetching warehouses: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/zones", response_model=List[dict[str, Any]])
async def get_zones(current_user: dict = Depends(get_current_user)):
    """Fetch all zones (floors) from ERP"""
    try:
        # Ensure connection is alive
        if not sql_connector.test_connection():
             raise HTTPException(status_code=503, detail="Database connection unavailable")

        zones = sql_connector.get_all_zones()
        return zones
    except Exception as e:
        logger.error(f"Error fetching zones: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
