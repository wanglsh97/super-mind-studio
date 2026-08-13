import { prepareAgentInput } from './uploaded-files-input'

describe('prepareAgentInput', () => {
  it('passes uploaded file paths to the model regardless of run mode', () => {
    expect(
      prepareAgentInput(
        '[[supermind-files]][{"name":"简历.pdf","path":"/workspace/input/简历.pdf"}][[/supermind-files]]\n分析这个文件',
      ),
    ).toBe(
      'Uploaded files in the Sandbox:\n- 简历.pdf: /workspace/input/简历.pdf\n\nUser request:\n分析这个文件',
    )
  })

  it('leaves ordinary messages unchanged', () => {
    expect(prepareAgentInput('你好')).toBe('你好')
  })
})
