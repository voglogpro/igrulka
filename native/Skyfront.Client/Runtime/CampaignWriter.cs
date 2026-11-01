using System.Text;

namespace Skyfront.Client.Runtime;

public sealed class CampaignWriter
{
    private readonly object _gate = new();
    private (string Path, string Data)? _latest;
    private bool _busy;
    private string _error = "";
    public string Error
    {
        get
        {
            lock (_gate)
                return _error;
        }
    }
    public bool Busy
    {
        get
        {
            lock (_gate)
                return _busy;
        }
    }
    public void Save(string path, string data)
    {
        lock (_gate)
        {
            _latest = (path, data);
            _error = "";
            if (_busy)
                return;
            _busy = true;
        }
        _ = Task.Run(async () =>
        {
            while (true)
            {
                (string Path, string Data) pending;
                lock (_gate)
                {
                    if (_latest == null)
                    {
                        _busy = false;
                        return;
                    }
                    pending = _latest.Value;
                    _latest = null;
                }
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(pending.Path)!);
                    var temporary = pending.Path + ".writing";
                    await File.WriteAllTextAsync(temporary, pending.Data, new UTF8Encoding(false));
                    File.Move(temporary, pending.Path, true);
                }
                catch (Exception e) { lock (_gate) _error = e.Message; }
            }
        });
    }
}
