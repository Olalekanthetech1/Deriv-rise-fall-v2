import sys, os, json, time, math, pickle, traceback
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','3')
import numpy as np
try: import xgboost as xgb
except Exception: xgb=None
try: import lightgbm as lgb
except Exception: lgb=None
try: import catboost as cb
except Exception: cb=None
try: from sklearn.ensemble import IsolationForest
except Exception: IsolationForest=None
try: from sklearn.metrics import accuracy_score, log_loss
except Exception: accuracy_score=log_loss=None
try: from hmmlearn.hmm import GaussianHMM
except Exception: GaussianHMM=None
try: from ml_deep_models import train as train_deep, predict as predict_deep
except Exception: train_deep=predict_deep=None
MODEL_DIR=Path(os.getenv('MODEL_CACHE_DIR',str(Path(__file__).resolve().parent.parent/'models_cache'))); MODEL_DIR.mkdir(parents=True,exist_ok=True)
SCHEMA='5.0'; FEATURES=37; SEQ=25; CACHE={}

def f(v,d=0.0):
    try: v=float(v); return v if math.isfinite(v) else d
    except Exception:return d
def std(a): return float(np.std(a)) if len(a)>1 else 0.0
def mom(a): return 0.0 if len(a)<2 or a[0]==0 else (a[-1]-a[0])/a[0]*100
def vel(a): return 0.0 if len(a)<2 else (a[-1]-a[0])/len(a)
def persist(a):
    if len(a)<2:return 0.0
    best=cur=1
    for i in range(1,len(a)):
        c=np.sign(a[i]-a[i-1]); p=np.sign(a[i-1]-a[i-2]) if i>1 else 0
        cur=cur+1 if c and c==p else 1; best=max(best,cur)
    return best/len(a)
def reversal(a): return 0.0 if len(a)<3 else sum(1 for i in range(2,len(a)) if (a[i-1]-a[i-2])*(a[i]-a[i-1])<0)/(len(a)-2)

def features(ticks,duration=5,asset=0,symbol=''):
    ticks=ticks or [{'price':100.0,'timestamp':int(time.time()*1000)}]; p=[f(t.get('price')) for t in ticks]; n=len(p); cur=p[-1]; sub=lambda k:p[max(0,n-k):]
    p1=p[-2] if n>1 else cur; p2=p[-3] if n>2 else p1; p3=p[-4] if n>3 else p2; d1=cur-p1; d2=cur-p2; d3=cur-p3
    up=sum(p[i]>p[i-1] for i in range(1,n)); down=sum(p[i]<p[i-1] for i in range(1,n)); td=max(1,n-1); cu=cd=0
    for i in range(n-1,0,-1):
        d=p[i]-p[i-1]
        if d>0:
            if cd:break
            cu+=1
        elif d<0:
            if cu:break
            cd+=1
        else:break
    mi,sh,md,ma=map(sub,(5,25,100,300)); half=max(1,len(sh)//2); sr=max(sh)-min(sh); comp=.5 if sr==0 else (cur-min(sh))/sr
    first=f(ticks[0].get('timestamp'),time.time()*1000); last=f(ticks[-1].get('timestamp'),time.time()*1000); elapsed=max(1,(last-first)/1000); mm=mom(ma)
    even=sum(int(f'{x:.5f}'[-1])%2==0 for x in p)
    return [d1,d2,d3,mom(mi),mom(sh),mom(md),mm,sr,abs(md[-1]-md[0]),abs(ma[-1]-ma[0]),up/td,down/td,(up-down)/td,cu,cd,persist(mi),persist(sh),reversal(sh),reversal(md),vel(mi),vel(sh),vel(md),vel(sh[half:])-vel(sh[:half]),n/elapsed,(cur-p[0])/elapsed,std(sh),std(md),std(ma),comp,max(md)-cur,cur-min(md),1 if mm>.05 else -1 if mm<-.05 else 0,1 if symbol.startswith('1HZ') or '1S' in symbol else 0,float(duration),math.log(max(1,duration)),even/max(1,n),float(asset)]
def X(t,d,a,s): return np.asarray([features(t,d,a,s)],dtype=np.float32)
def seq_X(t,d,a,s):
    if len(t)<SEQ: t=([t[0]] if t else [{'price':100}])*max(0,SEQ-len(t))+t
    return np.asarray([[features(t[max(0,i-SEQ):i],d,a,s) for i in range(1,len(t)+1)][-SEQ:]],dtype=np.float32)
def path(k,s,d): return MODEL_DIR/f'{s}_{d}s_{k}.pkl'
def load(k,s,d):
    key=(k,s,d)
    if key in CACHE:return CACHE[key]
    p=path(k,s,d)
    if not p.exists():return None
    try:
        with open(p,'rb') as h:a=pickle.load(h); CACHE[key]=a; return a
    except Exception:return None
def save(k,s,d,a):
    p=path(k,s,d); tmp=Path(str(p)+'.tmp')
    with open(tmp,'wb') as h:pickle.dump(a,h,pickle.HIGHEST_PROTOCOL)
    tmp.replace(p); CACHE[(k,s,d)]=a

def dataset(t,d,a,s):
    prices=[f(x.get('price')) for x in t]; look=max(1,int(d)); ctx=25
    if len(prices)<=ctx+look: raise ValueError(f'Insufficient ticks: need at least {ctx+look+1}')
    xx=[];yy=[]
    for i in range(ctx,len(prices)-look): xx.append(features(t[:i],d,a,s)); yy.append(int(prices[i+look]>prices[i]))
    if len(set(yy))<2: raise ValueError('Training labels contain only one class')
    return np.asarray(xx,np.float32),np.asarray(yy,np.int64)
def split(X,y): k=max(1,int(len(X)*.8)); return X[:k],X[k:],y[:k],y[k:]

def train_one(kind,t,d,a,s,h):
    X,y=dataset(t,d,a,s); Xt,Xv,yt,yv=split(X,y)
    if kind in ('xgboost','lightgbm','catboost'):
        if kind=='xgboost':
            if xgb is None:raise RuntimeError('xgboost unavailable')
            m=xgb.XGBClassifier(max_depth=int(h.get('maxDepth',6)),learning_rate=float(h.get('learningRate',.05)),n_estimators=int(h.get('numEstimators',100)),subsample=float(h.get('subsample',.8)),random_state=42,eval_metric='logloss',n_jobs=2).fit(Xt,yt)
        elif kind=='lightgbm':
            if lgb is None:raise RuntimeError('lightgbm unavailable')
            m=lgb.LGBMClassifier(n_estimators=int(h.get('numEstimators',100)),num_leaves=31,learning_rate=float(h.get('learningRate',.05)),random_state=42,verbosity=-1,n_jobs=2).fit(Xt,yt)
        else:
            if cb is None:raise RuntimeError('catboost unavailable')
            m=cb.CatBoostClassifier(iterations=int(h.get('numEstimators',100)),depth=int(h.get('maxDepth',6)),learning_rate=float(h.get('learningRate',.05)),verbose=False,random_seed=42,thread_count=2).fit(Xt,yt)
        pr=m.predict_proba(Xv); metrics={'accuracy':round(float(accuracy_score(yv,np.argmax(pr,axis=1)))*100,3),'logLoss':round(float(log_loss(yv,pr,labels=[0,1])),6)}
        save(kind,s,d,{'schemaVersion':SCHEMA,'modelType':kind,'featureCount':FEATURES,'model':m,'validation':metrics}); return {'success':True,'modelId':f'{s}_{d}s_{kind}','modelType':kind,'samplesCount':len(X),'validationSamples':len(Xv),**metrics,'engine':f'Trained native Python {kind}'}
    if kind in ('tcn','lstm','transformer'):
        if train_deep is None:raise RuntimeError('PyTorch sequence runtime unavailable')
        prices=[f(x.get('price')) for x in t]; look=max(1,int(d));
        if len(prices)<=SEQ+look:raise ValueError(f'Insufficient ticks: need at least {SEQ+look+1}')
        SX=[];sy=[]
        for i in range(SEQ,len(prices)-look): SX.append([features(t[j:i-(SEQ-1-j)],d,a,s) for j in range(i-SEQ+1,i+1)]); sy.append(int(prices[i+look]>prices[i]))
        SX=np.asarray(SX,np.float32); sy=np.asarray(sy,np.int64); k=max(1,int(len(SX)*.8)); m=train_deep(kind,SX[:k],sy[:k],epochs=int(h.get('epochs',8)),batch_size=int(h.get('batchSize',64)),lr=float(h.get('learningRate',.001)))
        with torch_no_grad():
            pr=predict_deep(kind,{x:v.cpu() for x,v in m.state_dict().items()},SX[k:])
        metrics={'accuracy':round(float(np.mean(np.argmax(pr,axis=1)==sy[k:]))*100,3),'logLoss':round(float(log_loss(sy[k:],pr,labels=[0,1])),6)}
        save(kind,s,d,{'schemaVersion':SCHEMA,'modelType':kind,'state_dict':{x:v.cpu() for x,v in m.state_dict().items()},'validation':metrics}); return {'success':True,'modelId':f'{s}_{d}s_{kind}','modelType':kind,'samplesCount':len(SX),'validationSamples':len(SX)-k,**metrics,'engine':f'Trained PyTorch {kind}'}
    if kind=='hmm':
        if GaussianHMM is None:raise RuntimeError('hmmlearn unavailable')
        m=GaussianHMM(n_components=4,covariance_type='diag',n_iter=100,random_state=42).fit(Xt[:,[0,3,10,25]]); m.state_labels=['LOW_VOLATILITY','DIRECTIONAL_EXPANSION','CHOPPY_REVERSAL','SPIKE_REGIME']; save(kind,s,d,{'model':m,'validationSamples':len(Xv),'trainedAt':time.time(),'schemaVersion':SCHEMA}); return {'success':True,'modelId':f'{s}_{d}s_hmm','modelType':'hmm','samplesCount':len(X),'validationSamples':len(Xv),'engine':'Trained hmmlearn GaussianHMM'}
    if kind=='isolation_forest':
        if IsolationForest is None:raise RuntimeError('scikit-learn unavailable')
        model=IsolationForest(n_estimators=200,contamination='auto',random_state=42,n_jobs=2).fit(Xt); save(kind,s,d,{'model':model,'validationSamples':len(Xv),'trainedAt':time.time(),'schemaVersion':SCHEMA}); return {'success':True,'modelId':f'{s}_{d}s_isolation_forest','modelType':kind,'samplesCount':len(X),'validationSamples':len(Xv),'engine':'Trained scikit-learn IsolationForest'}
    raise ValueError(kind)

def torch_no_grad():
    import torch
    return torch.no_grad()
def predict_one(req):
    s=req.get('symbol','R_100');t=req.get('ticks',[]);d=int(req.get('durationSecs',5));a=req.get('assetCategory',0);k=req.get('modelType','xgboost');m=load(k,s,d)
    if m is None:return {'success':False,'id':req.get('id'),'modelType':k,'error':'MODEL_UNAVAILABLE'}
    validation=m.get('validation',{}) if isinstance(m,dict) else {}
    metadata={'validation':validation,'modelSchema':m.get('schemaVersion',SCHEMA) if isinstance(m,dict) else SCHEMA,'trainedAt':m.get('trainedAt') if isinstance(m,dict) else None}
    if k in ('xgboost','lightgbm','catboost'):
        pr=m['model'].predict_proba(X(t,d,a,s))[0]; down,up=float(pr[0]),float(pr[1]); return {**result(req,k,up,down,m),**metadata}
    if k in ('tcn','lstm','transformer'):
        if predict_deep is None:return {'success':False,'id':req.get('id'),'modelType':k,'error':'PYTORCH_UNAVAILABLE'}
        pr=predict_deep(k,m['state_dict'],seq_X(t,d,a,s))[0]; return {**result(req,k,float(pr[1]),float(pr[0]),m),**metadata}
    if k=='hmm':
        model=m['model']; v=X(t,d,a,s); obs=v[:,[0,3,10,25]]; state=int(model.predict(obs)[0]); p=model.predict_proba(obs)[0]; labels=getattr(model,'state_labels',['LOW_VOLATILITY','DIRECTIONAL_EXPANSION','CHOPPY_REVERSAL','SPIKE_REGIME']); return {**{'success':True,'id':req.get('id'),'modelType':'hmm','primaryRegime':labels[state%4],'regimeState':state+1,'regimeProbabilities':[round(float(x)*100,2) for x in p],'engine':'Trained GaussianHMM'},**metadata}
    if k=='isolation_forest':
        v=X(t,d,a,s); model=m['model']; raw=float(model.score_samples(v)[0]); return {**{'success':True,'id':req.get('id'),'modelType':k,'isAnomaly':int(model.predict(v)[0])==-1,'anomalyScore':round(max(0,min(1,.5-raw)),4),'engine':'Trained IsolationForest'},**metadata}
    return {'success':False,'id':req.get('id'),'error':'UNSUPPORTED_MODEL'}
def result(req,k,up,down,m): return {'success':True,'id':req.get('id'),'symbol':req.get('symbol','R_100'),'durationSecs':req.get('durationSecs',5),'modelType':k,'signal':'CALL' if up>=down else 'PUT','confidence':round(max(up,down)*100,2),'probabilityUp':round(up*100,2),'probabilityDown':round(down*100,2),'rawScore':round(up-down,6),'modelVersion':SCHEMA,'engine':f'Trained native {k}'}
def main():
    sys.stdout.write(json.dumps({'type':'ready','schemaVersion':SCHEMA,'featureCount':FEATURES,'xgb':xgb is not None,'lgb':lgb is not None,'cat':cb is not None,'hmm':GaussianHMM is not None,'isolationForest':IsolationForest is not None,'torch':train_deep is not None})+'\n');sys.stdout.flush()
    for line in sys.stdin:
        r={}
        try:
            r=json.loads(line); act=r.get('action')
            if act=='predict':out=predict_one(r)
            elif act=='train':out=train_one(r.get('modelType','xgboost'),r.get('ticks',[]),int(r.get('durationSecs',5)),int(r.get('assetCategory',0)),r.get('symbol','R_100'),r.get('hyperparams',{}))
            elif act=='predict_ensemble':
                out={'success':True,'id':r.get('id'),'models':{k:predict_one({**r,'modelType':k}) for k in ('xgboost','lightgbm','catboost','tcn','lstm','transformer','hmm','isolation_forest')}}
            elif act=='ping':out={'success':True,'id':r.get('id'),'pong':True,'schemaVersion':SCHEMA}
            elif act=='list_models':out={'success':True,'id':r.get('id'),'models':[p.name for p in MODEL_DIR.glob('*.pkl')]}
            else:out={'success':False,'id':r.get('id'),'error':f'Unknown action {act}'}
        except Exception as e:out={'success':False,'id':r.get('id'),'error':str(e),'trace':traceback.format_exc(limit=4)}
        sys.stdout.write(json.dumps(out,default=str)+'\n');sys.stdout.flush()
if __name__=='__main__':main()