import sys, os, json, time, math, pickle, traceback
from pathlib import Path

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
try:
    import numpy as np
except Exception:
    np = None
try:
    import xgboost as xgb
except Exception:
    xgb = None
try:
    import lightgbm as lgb
except Exception:
    lgb = None
try:
    import catboost as cb
except Exception:
    cb = None
try:
    from sklearn.ensemble import IsolationForest
    from sklearn.metrics import accuracy_score, log_loss
except Exception:
    IsolationForest = None
    accuracy_score = log_loss = None
try:
    from hmmlearn.hmm import GaussianHMM
except Exception:
    GaussianHMM = None
try:
    import torch
    import torch.nn as nn
except Exception:
    torch = nn = None
try:
    import onnxruntime as ort
except Exception:
    ort = None

MODEL_DIR = Path(os.getenv('MODEL_CACHE_DIR', str(Path(__file__).resolve().parent.parent / 'models_cache')))
MODEL_DIR.mkdir(parents=True, exist_ok=True)
FEATURE_COUNT, SEQ_LEN, SCHEMA = 37, 25, '4.0'
CACHE = {}

def ok(v, d=0.0):
    try:
        v=float(v); return v if math.isfinite(v) else d
    except Exception: return d

def std(a): return float(np.std(a)) if np is not None and len(a)>1 else (0.0 if len(a)<2 else math.sqrt(sum((x-sum(a)/len(a))**2 for x in a)/len(a)))
def mom(a): return 0.0 if len(a)<2 or a[0]==0 else (a[-1]-a[0])/a[0]*100

def vel(a): return 0.0 if len(a)<2 else (a[-1]-a[0])/len(a)
def persist(a):
    if len(a)<2:return 0.0
    best=cur=1
    for i in range(1,len(a)):
        c=np.sign(a[i]-a[i-1]) if np is not None else (1 if a[i]>a[i-1] else -1 if a[i]<a[i-1] else 0)
        p=np.sign(a[i-1]-a[i-2]) if np is not None and i>1 else 0
        cur=cur+1 if c!=0 and c==p else 1; best=max(best,cur)
    return best/len(a)

def reversal(a):
    if len(a)<3:return 0.0
    return sum(1 for i in range(2,len(a)) if (a[i-1]-a[i-2])*(a[i]-a[i-1])<0)/(len(a)-2)

def features(ticks,duration=5,asset=0,symbol=''):
    ticks=ticks or [{'price':100.0,'timestamp':int(time.time()*1000)}]
    p=[ok(t.get('price')) for t in ticks]; n=len(p); cur=p[-1]
    sub=lambda k:p[max(0,n-k):]
    d1=cur-(p[-2] if n>1 else cur); d2=cur-(p[-3] if n>2 else p[-2] if n>1 else cur); d3=cur-(p[-4] if n>3 else p[-3] if n>2 else cur)
    up=sum(p[i]>p[i-1] for i in range(1,n)); down=sum(p[i]<p[i-1] for i in range(1,n)); td=max(1,n-1)
    cu=cd=0
    for i in range(n-1,0,-1):
        d=p[i]-p[i-1]
        if d>0:
            if cd:break
            cu+=1
        elif d<0:
            if cu:break
            cd+=1
        else:break
    mi,sh,md,ma=map(sub,(5,25,100,300)); half=max(1,len(sh)//2)
    first=ok(ticks[0].get('timestamp'),time.time()*1000); last=ok(ticks[-1].get('timestamp'),time.time()*1000); elapsed=max(1,(last-first)/1000)
    sr=max(sh)-min(sh); comp=.5 if sr==0 else (cur-min(sh))/sr
    even=sum(int(f'{x:.5f}'[-1])%2==0 for x in p)
    mm=mom(ma)
    return [d1,d2,d3,mom(mi),mom(sh),mom(md),mm,sr,abs(md[-1]-md[0]),abs(ma[-1]-ma[0]),up/td,down/td,(up-down)/td,cu,cd,persist(mi),persist(sh),reversal(sh),reversal(md),vel(mi),vel(sh),vel(md),vel(sh[half:])-vel(sh[:half]),n/elapsed,(cur-p[0])/elapsed,std(sh),std(md),std(ma),comp,max(md)-cur,cur-min(md),1 if mm>.05 else -1 if mm<-.05 else 0,1 if symbol.startswith('1HZ') or '1S' in symbol else 0,float(duration),math.log(max(1,duration)),even/max(1,n),float(asset)]

def Xmat(ticks,duration,asset,symbol): return np.asarray([features(ticks,duration,asset,symbol)],dtype=np.float32)
def path(kind,symbol,duration): return MODEL_DIR/f'{symbol}_{duration}s_{kind}.pkl'

def load(kind,symbol,duration):
    k=(kind,symbol,duration)
    if k in CACHE:return CACHE[k]
    p=path(kind,symbol,duration)
    if not p.exists():return None
    try:
        with open(p,'rb') as f:a=pickle.load(f)
        CACHE[k]=a; return a
    except Exception:return None

def save(kind,symbol,duration,a):
    p=path(kind,symbol,duration); tmp=Path(str(p)+'.tmp')
    with open(tmp,'wb') as f:pickle.dump(a,f,pickle.HIGHEST_PROTOCOL)
    tmp.replace(p); CACHE[(kind,symbol,duration)]=a; return p

def dataset(ticks,duration,asset,symbol,look=None):
    prices=[ok(t.get('price')) for t in ticks]; look=look or max(1,int(duration)); ctx=25
    if len(prices)<=ctx+look:raise ValueError(f'Insufficient ticks: need at least {ctx+look+1}')
    X=[];y=[]
    for i in range(ctx,len(prices)-look):X.append(features(ticks[:i],duration,asset,symbol));y.append(int(prices[i+look]>prices[i]))
    if len(set(y))<2:raise ValueError('Training labels contain only one class')
    return np.asarray(X,np.float32),np.asarray(y,np.int64)

def split(X,y):
    k=max(1,int(len(X)*.8));return X[:k],X[k:],y[:k],y[k:]

def train_tree(kind,X,y,h):
    if kind=='xgboost':
        if xgb is None:raise RuntimeError('xgboost unavailable')
        return xgb.XGBClassifier(max_depth=int(h.get('maxDepth',6)),learning_rate=float(h.get('learningRate',.05)),n_estimators=int(h.get('numEstimators',100)),subsample=float(h.get('subsample',.8)),random_state=42,eval_metric='logloss',n_jobs=2).fit(X,y)
    if kind=='lightgbm':
        if lgb is None:raise RuntimeError('lightgbm unavailable')
        return lgb.LGBMClassifier(n_estimators=int(h.get('numEstimators',100)),num_leaves=31,learning_rate=float(h.get('learningRate',.05)),random_state=42,verbosity=-1,n_jobs=2).fit(X,y)
    if kind=='catboost':
        if cb is None:raise RuntimeError('catboost unavailable')
        return cb.CatBoostClassifier(iterations=int(h.get('numEstimators',100)),depth=int(h.get('maxDepth',6)),learning_rate=float(h.get('learningRate',.05)),verbose=False,random_seed=42,thread_count=2).fit(X,y)
    raise ValueError(kind)

def train(kind,ticks,duration,asset,symbol,h):
    X,y=dataset(ticks,duration,asset,symbol); Xt,Xv,yt,yv=split(X,y)
    if kind in ('xgboost','lightgbm','catboost'):
        m=train_tree(kind,Xt,yt,h); probs=m.predict_proba(Xv); pred=(probs[:,1]>=.5).astype(int)
        metrics={'accuracy':round(float(accuracy_score(yv,pred))*100,3),'logLoss':round(float(log_loss(yv,probs,labels=[0,1])),6)}
        a={'schemaVersion':SCHEMA,'modelType':kind,'symbol':symbol,'durationSecs':duration,'featureCount':37,'model':m,'validation':metrics,'trainedAt':time.time()};save(kind,symbol,duration,a)
        return {'success':True,'modelId':f'{symbol}_{duration}s_{kind}','modelType':kind,'samplesCount':len(X),'validationSamples':len(Xv),**metrics,'format':'PKL','engine':f'Trained Python {kind}'}
    if kind=='isolation_forest':
        if IsolationForest is None:raise RuntimeError('scikit-learn unavailable')
        m=IsolationForest(n_estimators=200,contamination='auto',random_state=42,n_jobs=2).fit(Xt);save(kind,symbol,duration,{'model':m,'schemaVersion':SCHEMA});return {'success':True,'modelId':f'{symbol}_{duration}s_{kind}','modelType':kind,'samplesCount':len(X),'engine':'Trained scikit-learn IsolationForest'}
    if kind=='hmm':
        if GaussianHMM is None:raise RuntimeError('hmmlearn unavailable')
        obs=Xt[:,[0,3,10,25]].astype(float);m=GaussianHMM(n_components=4,covariance_type='diag',n_iter=100,random_state=42).fit(obs);m.state_labels=['LOW_VOLATILITY','DIRECTIONAL_EXPANSION','CHOPPY_REVERSAL','SPIKE_REGIME'];save(kind,symbol,duration,m);return {'success':True,'modelId':f'{symbol}_{duration}s_hmm','modelType':'hmm','samplesCount':len(X),'engine':'Trained hmmlearn GaussianHMM'}
    raise RuntimeError('Deep model training requires the optional PyTorch sequence trainer; inference never fabricates a neural model')

def predict(req):
    symbol=req.get('symbol','R_100');ticks=req.get('ticks',[]);duration=int(req.get('durationSecs',5));asset=req.get('assetCategory',0);kind=req.get('modelType','xgboost');v=Xmat(ticks,duration,asset,symbol)
    a=load(kind,symbol,duration)
    if a is None:return {'success':False,'id':req.get('id'),'error':'MODEL_UNAVAILABLE','modelType':kind}
    if kind in ('xgboost','lightgbm','catboost'):
        probs=a['model'].predict_proba(v)[0];down,up=float(probs[0]),float(probs[1])
    elif kind=='isolation_forest':
        m=a['model'];raw=float(m.score_samples(v)[0]);return {'success':True,'id':req.get('id'),'modelType':kind,'isAnomaly':int(m.predict(v)[0])==-1,'anomalyScore':round(max(0,min(1,.5-raw)),4),'engine':'Native trained IsolationForest'}
    elif kind=='hmm':
        obs=v[:,[0,3,10,25]].astype(float);state=int(a.predict(obs)[0]);probs=a.predict_proba(obs)[0];labels=getattr(a,'state_labels',['LOW_VOLATILITY','DIRECTIONAL_EXPANSION','CHOPPY_REVERSAL','SPIKE_REGIME']);return {'success':True,'id':req.get('id'),'modelType':'hmm','primaryRegime':labels[state%len(labels)],'regimeState':state+1,'regimeProbabilities':[round(float(x)*100,2) for x in probs],'engine':'Native trained GaussianHMM'}
    else:return {'success':False,'id':req.get('id'),'error':'MODEL_UNAVAILABLE','modelType':kind}
    return {'success':True,'id':req.get('id'),'symbol':symbol,'durationSecs':duration,'modelType':kind,'signal':'CALL' if up>=down else 'PUT','confidence':round(max(up,down)*100,2),'probabilityUp':round(up*100,2),'probabilityDown':round(down*100,2),'rawScore':round(up-down,6),'modelVersion':SCHEMA,'engine':f'Native trained {kind}','timestamp':int(time.time()*1000)}

def main():
    sys.stdout.write(json.dumps({'type':'ready','schemaVersion':SCHEMA,'featureCount':37,'xgb':xgb is not None,'lgb':lgb is not None,'cat':cb is not None,'hmm':GaussianHMM is not None,'sklearn':IsolationForest is not None,'torch':torch is not None,'onnx':ort is not None})+'\n');sys.stdout.flush()
    for line in sys.stdin:
        try:
            r=json.loads(line);a=r.get('action')
            if a=='predict':out=predict(r)
            elif a=='train':out=train(r.get('modelType','xgboost'),r.get('ticks',[]),int(r.get('durationSecs',5)),int(r.get('assetCategory',0)),r.get('symbol','R_100'),r.get('hyperparams',{}))
            elif a=='predict_ensemble':out={'success':True,'id':r.get('id'),'models':{k:predict({**r,'modelType':k}) for k in ('xgboost','lightgbm','catboost','hmm','isolation_forest')}}
            elif a=='list_models':out={'success':True,'id':r.get('id'),'models':[{'filename':p.name,'sizeBytes':p.stat().st_size} for p in MODEL_DIR.iterdir() if p.suffix=='.pkl']}
            elif a=='ping':out={'success':True,'id':r.get('id'),'pong':True,'schemaVersion':SCHEMA}
            else:out={'success':False,'id':r.get('id'),'error':f'Unknown action {a}'}
        except Exception as e:out={'success':False,'id':r.get('id') if isinstance(r,dict) else None,'error':str(e),'trace':traceback.format_exc(limit=4)}
        sys.stdout.write(json.dumps(out,default=str)+'\n');sys.stdout.flush()
if __name__=='__main__':main()
