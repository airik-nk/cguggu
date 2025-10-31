# models.py
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class BaseModel(db.Model):
    __abstract__ = True
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Document(db.Model):  # <-- [修改] 不再繼承 BaseModel，改為繼承 db.Model
    __tablename__ = 'document' # <-- [新增] 明確指定表名
    
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    department = db.Column(db.String(120), index=True)
    doc_no = db.Column(db.String(64))        # 規章編號 / No.
    date_issued = db.Column(db.Date)         # 公布/公告日期 / Date issued
    review_meeting = db.Column(db.String(128))  # 審議會議 / Review Meeting
    
    # [移除] 移除 rag_doc_id 欄位，因為 api.py 沒有提供它，且 DB 可能不存在
    # rag_doc_id = db.Column(db.String(128), index=True)

class DocumentVersion(BaseModel):
    id = db.Column(db.Integer, primary_key=True)
    doc_id = db.Column(db.Integer, db.ForeignKey('document.id'), index=True)
    date_issued = db.Column(db.Date) 
    is_active = db.Column(db.Boolean, default=True)
    file_path = db.Column(db.String(500))             # 原檔路徑
    text_hash = db.Column(db.String(64), index=True)  # 全文雜湊，用於比對重複
    rag_doc_id = db.Column(db.String(128), index=True)

class Chunk(BaseModel):
    id = db.Column(db.Integer, primary_key=True)
    version_id = db.Column(db.Integer, db.ForeignKey('document_version.id'), index=True)
    section_ref = db.Column(db.String(120), index=True)   # 第x條/第x點
    content = db.Column(db.Text, nullable=False)
    chunk_index = db.Column(db.Integer, index=True)
    embedding = db.Column(db.LargeBinary)  # 若用 pgvector 可改 vector(type)
    source_page = db.Column(db.Integer)
    language = db.Column(db.String(10), default='zh-TW')
    hash = db.Column(db.String(64), index=True)
    rag_doc_id = db.Column(db.String(128), index=True)

class QaLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    question = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text)
    used_chunks = db.Column(db.Text)  # 存 JSON（doc/version/section）
    user_id = db.Column(db.String(120))  # 之後可綁 SSO

class UploadLog(db.Model):
    __tablename__ = "upload_logs"
    id = db.Column(db.Integer, primary_key=True)
    kb = db.Column(db.String(128), nullable=True, index=True)
    doc_no = db.Column(db.String(256), nullable=True)
    title = db.Column(db.String(512), nullable=False)
    display_name = db.Column(db.String(512), nullable=True)
    rag_doc_id = db.Column(db.String(128), nullable=True)
    rag_status = db.Column(db.String(32), nullable=True)  # NOT_SYNCED / PENDING / SUCCESS / ERROR / ...
    uploaded_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)