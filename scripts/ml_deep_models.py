"""Small, trainable PyTorch sequence models used by ml_runtime_v4."""
import numpy as np
import torch
import torch.nn as nn

FEATURE_COUNT = 37
SEQUENCE_LENGTH = 25

class TCN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(FEATURE_COUNT, 64, 3, padding=1), nn.ReLU(),
            nn.Conv1d(64, 64, 3, padding=2, dilation=2), nn.ReLU(),
            nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(64, 2)
        )
    def forward(self, x): return self.net(x.transpose(1, 2))

class LSTM(nn.Module):
    def __init__(self):
        super().__init__(); self.rnn=nn.LSTM(FEATURE_COUNT,64,batch_first=True); self.head=nn.Linear(64,2)
    def forward(self,x): return self.head(self.rnn(x)[0][:,-1,:])

class Transformer(nn.Module):
    def __init__(self):
        super().__init__(); self.proj=nn.Linear(FEATURE_COUNT,64)
        layer=nn.TransformerEncoderLayer(d_model=64,nhead=4,batch_first=True,dropout=.1)
        self.encoder=nn.TransformerEncoder(layer,num_layers=2); self.head=nn.Linear(64,2)
    def forward(self,x): return self.head(self.encoder(self.proj(x))[:,-1,:])

def make(kind):
    if kind=='tcn': return TCN()
    if kind=='lstm': return LSTM()
    if kind=='transformer': return Transformer()
    raise ValueError(kind)

def train(kind,X,y,epochs=8,batch_size=64,lr=.001):
    torch.manual_seed(42); model=make(kind); opt=torch.optim.Adam(model.parameters(),lr=lr); loss_fn=nn.CrossEntropyLoss()
    xt=torch.tensor(X,dtype=torch.float32); yt=torch.tensor(y,dtype=torch.long); model.train()
    for _ in range(max(1,epochs)):
        order=torch.randperm(len(xt))
        for s in range(0,len(order),batch_size):
            idx=order[s:s+batch_size]; opt.zero_grad(set_to_none=True); loss=loss_fn(model(xt[idx]),yt[idx]); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(),1.0); opt.step()
    return model

def predict(kind,state_dict,X):
    model=make(kind); model.load_state_dict(state_dict); model.eval()
    with torch.no_grad(): return torch.softmax(model(torch.tensor(X,dtype=torch.float32)),dim=-1).cpu().numpy()
