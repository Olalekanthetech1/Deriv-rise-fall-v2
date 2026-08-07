export const tradeStrategyStore = {
  lastStrategy: 'Manual',
  setStrategy(strategy: string) {
    this.lastStrategy = strategy;
  },
  getStrategy() {
    return this.lastStrategy;
  }
};
