export interface AgentLoopState {
  goal: string;
  iteration: number;
  maxIterations: number;
}

export class AgentLoop {
  next(state: AgentLoopState): AgentLoopState {
    return {
      ...state,
      iteration: state.iteration + 1
    };
  }
}
